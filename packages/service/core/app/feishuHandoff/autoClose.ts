import { createHash } from 'node:crypto';
import { LeaseCache, isRedisLeaseError } from '@fastgpt/dal/redis/caches/lease';
import { FeishuHandoffConfigSchema } from '@fastgpt/global/core/app/feishuHandoff';
import { getLogger, LogCategories } from '../../../common/logger';
import { mongoSessionRun } from '../../../common/mongo/sessionRun';
import { getFeishuTenantToken } from '../../../support/user/feishu/client';
import { MongoApp } from '../schema';
import {
  getFeishuHandoffBotCredentials,
  listFeishuHandoffMessages,
  sendFeishuHandoffCard,
  disbandFeishuHandoffChat,
  isDisbandedFeishuHandoffChat,
  type FeishuHandoffMessage
} from './bot';
import { captureFeishuHandoffTranscript } from './knowledge';
import { MongoFeishuHandoff, MongoFeishuHandoffTranscript } from './schema';

const logger = getLogger(LogCategories.MODULE.USER.ACCOUNT);
const lease = new LeaseCache();
const minuteMs = 60_000;

/** 只把真人发言算作群活跃，欢迎卡片和系统通知不会续期。 */
export function getLatestHandoffActivity(messages: FeishuHandoffMessage[], since: Date) {
  return messages.find(
    (message) => message.sender?.sender_type === 'user' && message.create_time >= since.getTime()
  )?.create_time;
}

/** 处理到期的客服群，与普通转人工请求使用同一租约。 */
export async function runFeishuHandoffAutoClose() {
  const credentials = getFeishuHandoffBotCredentials();
  if (!credentials) return;

  const due = await MongoFeishuHandoff.find({
    botAppId: credentials.appId,
    nextCloseCheckAt: { $lte: new Date() }
  })
    .select('_id leaseKey')
    .sort({ nextCloseCheckAt: 1 })
    .limit(20)
    .lean();
  if (!due.length) return;

  const token = await getFeishuTenantToken(credentials);
  await Promise.all(
    due.map(async ({ _id, leaseKey }) => {
      if (!leaseKey) return;
      try {
        await lease.withLease({
          key: leaseKey,
          label: 'Feishu handoff auto close',
          ttlMs: 30_000,
          fn: async ({ assertValid }) => {
            const now = new Date();
            const record = await MongoFeishuHandoff.findOne({
              _id,
              botAppId: credentials.appId,
              nextCloseCheckAt: { $lte: now }
            }).lean();
            if (!record?.feishuChatId || !record.groupCreatedAt || record.closedAt) return;

            const chatId = record.feishuChatId;
            const filter = { _id, feishuChatId: chatId };
            const app = await MongoApp.findOne({ _id: record.appId, deleteTime: null })
              .select('teamId +feishuHandoff')
              .lean();
            const parsed = FeishuHandoffConfigSchema.safeParse(app?.feishuHandoff);
            const policy = parsed.data?.autoClose;
            if (!app || !parsed.data?.enabled || !policy?.enabled) {
              await MongoFeishuHandoff.updateOne(filter, {
                $set: { nextCloseCheckAt: new Date(now.getTime() + 5 * minuteMs) },
                $unset: { promptedAt: 1, disbandRequested: 1 }
              });
              return;
            }

            const checkAgain = (at: number) =>
              MongoFeishuHandoff.updateOne(filter, {
                $set: { nextCloseCheckAt: new Date(Math.max(at, now.getTime() + 10_000)) }
              });
            const resetTimer = async (lastActivity: number) => {
              assertValid();
              await MongoFeishuHandoff.updateOne(filter, {
                $set: { nextCloseCheckAt: new Date(lastActivity + policy.idleMinutes * minuteMs) },
                $unset: { promptedAt: 1, disbandRequested: 1 }
              });
            };
            const finish = async (releaseTranscript: boolean) => {
              assertValid();
              await mongoSessionRun(async (session) => {
                await MongoFeishuHandoff.updateOne(
                  filter,
                  { $set: { closedAt: new Date() }, $unset: { nextCloseCheckAt: 1 } },
                  { session }
                );
                if (releaseTranscript) {
                  await MongoFeishuHandoffTranscript.updateOne(
                    { _id: chatId, extractedAt: null },
                    { $set: { nextExtractionAt: new Date() } },
                    { session }
                  );
                }
              });
            };
            const activitySince = async (since: Date) => {
              const { messages, truncated } = await listFeishuHandoffMessages({
                token,
                chatId,
                since,
                maxPages: 2
              });
              return (
                getLatestHandoffActivity(messages, since) ?? (truncated ? Date.now() : undefined)
              );
            };

            try {
              // 1. 达到静默时长才发提醒。提醒后再按独立的等待时间检查。
              if (!record.promptedAt) {
                const idleMs = policy.idleMinutes * minuteMs;
                const firstCheckAt = record.groupCreatedAt.getTime() + idleMs;
                if (now.getTime() < firstCheckAt) {
                  await checkAgain(firstCheckAt);
                  return;
                }
                const recent = await activitySince(new Date(now.getTime() - idleMs));
                if (recent !== undefined) {
                  await resetTimer(recent);
                  return;
                }
                assertValid();
                await sendFeishuHandoffCard({
                  token,
                  chatId,
                  title: '还有其他问题吗？',
                  content: policy.prompt.replaceAll('{minutes}', String(policy.graceMinutes)),
                  uuid: createHash('sha256')
                    .update(`${chatId}:idle:${record.nextCloseCheckAt?.getTime()}`)
                    .digest('hex')
                    .slice(0, 40)
                });
                await MongoFeishuHandoff.updateOne(filter, {
                  promptedAt: now,
                  nextCloseCheckAt: new Date(Date.now() + 10_000)
                });
                return;
              }

              const recent = await activitySince(record.promptedAt);
              if (recent !== undefined) {
                await resetTimer(recent);
                return;
              }
              const deadline = record.promptedAt.getTime() + policy.graceMinutes * minuteMs;
              if (now.getTime() < deadline) {
                await checkAgain(Math.min(deadline, now.getTime() + 10_000));
                return;
              }

              // 2. 保存成功才能继续解散。模型提炼在群解散后异步运行。
              const mining = parsed.data.knowledgeMining;
              if (mining?.enabled && mining.datasetId) {
                const tmbId = app.feishuHandoff?.knowledgeMining?.tmbId;
                if (!tmbId) throw new Error('Missing Feishu knowledge configuration author');
                assertValid();
                await captureFeishuHandoffTranscript({
                  token,
                  chatId,
                  record,
                  teamId: String(app.teamId),
                  target: {
                    datasetId: mining.datasetId,
                    targetCollectionId: mining.targetCollectionId,
                    tmbId: String(tmbId),
                    retainDays: mining.retainDays
                  }
                });
              }
              const current = await MongoApp.findOne({ _id: record.appId, deleteTime: null })
                .select('+feishuHandoff')
                .lean();
              const currentConfig = FeishuHandoffConfigSchema.safeParse(current?.feishuHandoff);
              if (
                !currentConfig.success ||
                !currentConfig.data.enabled ||
                JSON.stringify(currentConfig.data.autoClose) !== JSON.stringify(policy) ||
                JSON.stringify(currentConfig.data.knowledgeMining) !== JSON.stringify(mining)
              ) {
                await checkAgain(Date.now());
                return;
              }
              if (policy.farewell) {
                assertValid();
                await sendFeishuHandoffCard({
                  token,
                  chatId,
                  title: '本次咨询已结束',
                  content: policy.farewell,
                  uuid: createHash('sha256')
                    .update(`${chatId}:farewell:${record.promptedAt.getTime()}`)
                    .digest('hex')
                    .slice(0, 40)
                });
              }
              const finalActivity = await activitySince(record.promptedAt);
              if (finalActivity !== undefined) {
                await resetTimer(finalActivity);
                return;
              }
              assertValid();
              await MongoFeishuHandoff.updateOne(filter, {
                disbandRequested: mining?.enabled === true
              });
              assertValid();
              await disbandFeishuHandoffChat(token, chatId);
              await finish(mining?.enabled === true);
            } catch (error) {
              if (isDisbandedFeishuHandoffChat(error)) {
                await finish(record.disbandRequested === true);
                return;
              }
              await checkAgain(Date.now() + 5 * minuteMs);
              throw error;
            }
          }
        });
      } catch (error) {
        if (!isRedisLeaseError(error)) {
          logger.warn('Feishu handoff auto close will retry', { handoffId: _id, error });
        }
      }
    })
  );
}
