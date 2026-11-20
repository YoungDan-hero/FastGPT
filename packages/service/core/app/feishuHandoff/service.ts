import { createHash, randomUUID } from 'node:crypto';
import {
  FeishuHandoffConfigSchema,
  feishuHandoffAppTypes,
  getFeishuHandoffMessageText
} from '@fastgpt/global/core/app/feishuHandoff';
import type { FeishuHandoffTurn } from '@fastgpt/global/openapi/core/app/feishuHandoff/api';
import { ChatRoleEnum, ChatSourceTypeEnum } from '@fastgpt/global/core/chat/constants';
import { UserError } from '@fastgpt/global/common/error/utils';
import { TeamMemberStatusEnum } from '@fastgpt/global/support/user/team/constant';
import { LeaseCache, isRedisLeaseError } from '@fastgpt/dal/redis/caches/lease';
import { getLogger, LogCategories } from '../../../common/logger';
import { MongoUser } from '../../../support/user/schema';
import { MongoTeamMember } from '../../../support/user/team/teamMemberSchema';
import { directoryVerifiedUser } from '../../../support/user/feishu/member';
import { getFeishuTenantToken } from '../../../support/user/feishu/client';
import { MongoChatItem } from '../../chat/chatItemSchema';
import { buildChatSourceQuery } from '../../chat/source';
import { MongoApp } from '../schema';
import { MongoFeishuHandoff, MongoFeishuHandoffGroup } from './schema';
import {
  createFeishuHandoffChat,
  getFeishuHandoffBotCredentials,
  sendFeishuHandoffCard
} from './bot';

const logger = getLogger(LogCategories.MODULE.USER.ACCOUNT);
const lease = new LeaseCache();
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** 同时核对团队成员状态和近期飞书通讯录快照。 */
export async function getFeishuHandoffMembers(teamId: string, memberIds?: string[]) {
  const members = await MongoTeamMember.find(
    {
      teamId,
      status: TeamMemberStatusEnum.active,
      ...(memberIds && { _id: { $in: memberIds } })
    },
    'name userId'
  )
    .sort({ name: 1 })
    .lean();
  const users = await MongoUser.find(
    { ...directoryVerifiedUser(teamId), _id: { $in: members.map(({ userId }) => userId) } },
    '_id feishuOrg.unionId'
  ).lean();
  const unionIds = new Map(users.map((user) => [String(user._id), user.feishuOrg?.unionId]));
  return members.flatMap(({ _id, userId, name }) => {
    const unionId = unionIds.get(String(userId));
    return unionId ? [{ id: String(_id), name, unionId }] : [];
  });
}

/** 同一租约保护组删除与应用绑定，避免应用绑定到已删除的客服组。 */
export async function updateFeishuHandoffSettings<T>(teamId: string, update: () => Promise<T>) {
  try {
    return await lease.withLease({
      key: `feishu-handoff-settings:${teamId}`,
      label: 'Feishu handoff settings',
      ttlMs: 30_000,
      fn: ({ assertValid }) => {
        assertValid();
        return update();
      }
    });
  } catch (error) {
    if (isRedisLeaseError(error)) throw new UserError('客服配置正在更新，请稍后重试');
    throw error;
  }
}

/** 初始化聊天时按应用配置判断是否显示人工客服入口。 */
export async function getFeishuHandoffChatOptions(appId: string, teamId: string) {
  if (!getFeishuHandoffBotCredentials()) return;
  const app = await MongoApp.findOne({
    _id: appId,
    teamId,
    deleteTime: null,
    type: { $in: feishuHandoffAppTypes }
  })
    .select('feishuHandoff')
    .lean();
  const config = FeishuHandoffConfigSchema.safeParse(app?.feishuHandoff);
  if (config.success && config.data.enabled) {
    return { categories: [] };
  }
}

/** 为已验证归属的会话发起飞书转接，失败重试会继续使用已经创建的群。 */
export async function transferChatToFeishu({
  teamId,
  tmbId,
  appId,
  chatId,
  turn,
  note
}: {
  teamId: string;
  tmbId: string;
  appId: string;
  chatId: string;
  turn?: FeishuHandoffTurn;
  note?: string;
}) {
  const credentials = getFeishuHandoffBotCredentials();
  if (!credentials) throw new UserError('管理员尚未配置飞书客服机器人');

  try {
    return await lease.withLease({
      key: `feishu-handoff:${digest([teamId, tmbId, appId, chatId])}`,
      label: 'Feishu handoff',
      ttlMs: 30_000,
      fn: async ({ assertValid }) => {
        const app = await MongoApp.findOne({
          _id: appId,
          teamId,
          deleteTime: null,
          type: { $in: feishuHandoffAppTypes }
        })
          .select('name feishuHandoff')
          .lean();
        const config = FeishuHandoffConfigSchema.safeParse(app?.feishuHandoff);
        if (!app || !config.success || !config.data.enabled || !config.data.defaultGroupId) {
          throw new UserError('此应用未启用人工客服');
        }
        const groupId = config.data.defaultGroupId;
        const group = await MongoFeishuHandoffGroup.findOne({ _id: groupId, teamId }).lean();
        if (!group) throw new UserError('客服组已不可用，请联系应用维护者');

        const members = await getFeishuHandoffMembers(teamId, [
          tmbId,
          ...group.memberIds.map(String)
        ]);
        const requester = members.find(({ id }) => id === tmbId);
        if (!requester) throw new UserError('尚未同步你的飞书转接身份，请联系管理员');
        const agents = members.filter(({ unionId }) => unionId !== requester.unionId);
        if (agents.length === 0) throw new UserError('客服组没有可接待的飞书成员');
        const unionIds = [...new Set([requester.unionId, ...agents.map(({ unionId }) => unionId)])];

        const chatItems = {
          ...buildChatSourceQuery({ sourceType: ChatSourceTypeEnum.app, sourceId: appId }),
          teamId,
          chatId
        };
        const question = await MongoChatItem.findOne(
          {
            ...chatItems,
            obj: ChatRoleEnum.Human,
            hideInUI: { $ne: true },
            deleteTime: null,
            ...(turn && { dataId: turn.questionId })
          },
          'value'
        )
          .sort({ _id: -1 })
          .lean();
        if (!question) throw new UserError('未找到所选提问，请刷新对话后重试');

        // 隐藏或已删除的消息仍是轮次边界，避免把下一轮的回答发到群里。
        const nextItem =
          !turn || turn.answerId
            ? await MongoChatItem.findOne(
                {
                  ...chatItems,
                  _id: { $gt: question._id },
                  obj: { $in: [ChatRoleEnum.Human, ChatRoleEnum.AI] }
                },
                'obj value dataId hideInUI deleteTime'
              )
                .sort({ _id: 1 })
                .lean()
            : undefined;
        const answer =
          nextItem?.obj === ChatRoleEnum.AI &&
          !nextItem.deleteTime &&
          !('hideInUI' in nextItem && nextItem.hideInUI)
            ? nextItem
            : undefined;
        if (turn?.answerId && answer?.dataId !== turn.answerId) {
          throw new UserError('这轮问答已变更，请刷新对话后重试');
        }
        const questionText = getFeishuHandoffMessageText(question.value);
        const answerText = answer ? getFeishuHandoffMessageText(answer.value) : '';
        const content = [
          `应用：${app.name.slice(0, 80)}`,
          `提问人：${requester.name.slice(0, 80)}`,
          questionText && `问题\n${questionText}`,
          answerText && `回答\n${answerText}`,
          note && `补充说明\n${note}`
        ]
          .filter(Boolean)
          .join('\n\n');

        // 人员变化后建立新群，避免继续把新对话交给已调离的接待人。
        const id = digest([
          teamId,
          appId,
          chatId,
          tmbId,
          groupId,
          credentials.appId,
          unionIds.sort()
        ]);
        const record = await MongoFeishuHandoff.findOneAndUpdate(
          { _id: id },
          { $setOnInsert: { appId, chatId, createUuid: randomUUID() } },
          { upsert: true, new: true }
        ).lean();
        let feishuChatId = record.feishuChatId;
        const reused = Boolean(feishuChatId);
        const messageKey = digest([id, content]).slice(0, 40);
        if (!feishuChatId || record.lastMessageKey !== messageKey) {
          const token = await getFeishuTenantToken(credentials);
          assertValid();
          if (!feishuChatId) {
            const result = await createFeishuHandoffChat({
              token,
              name: `${group.name} · ${requester.name}`,
              unionIds,
              uuid: record.createUuid
            });
            assertValid();
            if (result.invalid_id_list?.length) {
              // 飞书可能已创建部分成员的群。该群不可用于交接，修正权限后可重新建群。
              await MongoFeishuHandoff.updateOne({ _id: id }, { createUuid: randomUUID() });
              throw new UserError('部分成员未能加入飞书群，请管理员检查客服机器人的可用范围');
            }
            feishuChatId = result.chat_id;
            // 即使发送卡片失败，也保留成功建立的群以便重试。
            await MongoFeishuHandoff.updateOne({ _id: id }, { feishuChatId });
          }
          assertValid();
          await sendFeishuHandoffCard({ token, chatId: feishuChatId, content, uuid: messageKey });
          assertValid();
          await MongoFeishuHandoff.updateOne({ _id: id }, { lastMessageKey: messageKey });
        }

        return {
          chatUrl: `https://applink.feishu.cn/client/chat/open?openChatId=${encodeURIComponent(feishuChatId)}`,
          groupName: group.name,
          reused
        };
      }
    });
  } catch (error) {
    if (error instanceof UserError) throw error;
    if (isRedisLeaseError(error)) throw new UserError('转人工正在处理，请稍后重试');
    logger.warn('Feishu handoff failed', { appId, error });
    throw new UserError('飞书客服转接失败，请重试或请管理员检查机器人的建群和发消息权限');
  }
}
