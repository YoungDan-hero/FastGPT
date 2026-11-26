import { z } from 'zod';
import { FeishuRequestError, feishuRequest } from '../../../support/user/feishu/client';
import { serviceEnv } from '../../../env';

export const getFeishuHandoffBotCredentials = () => {
  const { FEISHU_ORG_ENABLED, FEISHU_BOT_APP_ID, FEISHU_BOT_APP_SECRET } = serviceEnv;
  return FEISHU_ORG_ENABLED && FEISHU_BOT_APP_ID && FEISHU_BOT_APP_SECRET
    ? { appId: FEISHU_BOT_APP_ID, secret: FEISHU_BOT_APP_SECRET }
    : undefined;
};

const ChatIdSchema = z.string().regex(/^oc_[A-Za-z0-9_-]+$/);
const CreateGroupSchema = z.object({
  data: z.object({
    chat_id: ChatIdSchema,
    invalid_id_list: z.array(z.string()).nullish()
  })
});

/** 调用客服机器人的建群权限，尝试建群时复用同一个请求 UUID。 */
export async function createFeishuHandoffChat({
  token,
  name,
  unionIds,
  uuid
}: {
  token: string;
  name: string;
  unionIds: string[];
  uuid: string;
}) {
  const query = new URLSearchParams({ user_id_type: 'union_id', uuid });
  const { data } = await feishuRequest(`/im/v1/chats?${query}`, CreateGroupSchema, {
    token,
    body: {
      name: name.slice(0, 60),
      user_id_list: unionIds,
      chat_mode: 'group',
      chat_type: 'private'
    }
  });
  return data;
}

/** 交接内容通过普通文本组件发送，避免把聊天内容解释为卡片指令。 */
export async function sendFeishuHandoffCard({
  token,
  chatId,
  content,
  uuid,
  title = '人工客服交接'
}: {
  token: string;
  chatId: string;
  content: string;
  uuid: string;
  title?: string;
}) {
  await feishuRequest(
    '/im/v1/messages?receive_id_type=chat_id',
    z.object({ data: z.object({ message_id: z.string().min(1) }) }),
    {
      token,
      body: {
        receive_id: ChatIdSchema.parse(chatId),
        msg_type: 'interactive',
        uuid,
        content: JSON.stringify({
          schema: '2.0',
          header: { title: { tag: 'plain_text', content: title }, template: 'blue' },
          body: { elements: [{ tag: 'div', text: { tag: 'plain_text', content } }] }
        })
      }
    }
  );
}

const FeishuHandoffHistorySchema = z.object({
  data: z.object({
    has_more: z.boolean(),
    page_token: z.string().nullish(),
    items: z
      .array(
        z.object({
          message_id: z.string(),
          msg_type: z.string(),
          create_time: z.coerce.number().int().positive(),
          deleted: z.boolean().optional(),
          sender: z
            .object({
              id: z.string().nullish(),
              id_type: z.string().nullish(),
              sender_type: z.string().nullish()
            })
            .nullish(),
          body: z.object({ content: z.string() }).nullish()
        })
      )
      .nullish()
  })
});
export type FeishuHandoffMessage = NonNullable<
  z.infer<typeof FeishuHandoffHistorySchema>['data']['items']
>[number];

/** 按时间倒序分页拉取群消息，保留分页截断标志供闲置检测和后续审核。 */
export async function listFeishuHandoffMessages({
  token,
  chatId,
  since,
  maxPages
}: {
  token: string;
  chatId: string;
  since: Date;
  maxPages: number;
}) {
  const query = new URLSearchParams({
    container_id_type: 'chat',
    container_id: ChatIdSchema.parse(chatId),
    start_time: String(Math.floor(since.getTime() / 1000)),
    sort_type: 'ByCreateTimeDesc',
    page_size: '50'
  });
  const messages: FeishuHandoffMessage[] = [];
  for (let page = 0; page < maxPages; page++) {
    const { data } = await feishuRequest(`/im/v1/messages?${query}`, FeishuHandoffHistorySchema, {
      token
    });
    messages.push(...(data.items ?? []));
    if (!data.has_more) return { messages, truncated: false };
    if (!data.page_token) break;
    query.set('page_token', data.page_token);
  }
  return { messages, truncated: true };
}

/** 将机器人侧的发言者 ID 转成通讯录使用的 union_id。 */
export async function getFeishuHandoffUnionId(token: string, openId: string) {
  const { data } = await feishuRequest(
    `/contact/v3/users/${encodeURIComponent(openId)}?user_id_type=open_id`,
    z.object({ data: z.object({ user: z.object({ union_id: z.string().startsWith('on_') }) }) }),
    { token }
  );
  return data.user.union_id;
}

/** 飞书返回群已解散时，可确认之前的不确定请求已完成。 */
export function isDisbandedFeishuHandoffChat(error: unknown) {
  return error instanceof FeishuRequestError && error.code === 232009;
}

/** 仅解散持久化记录中、本机器人建立的普通客服群。 */
export async function disbandFeishuHandoffChat(token: string, chatId: string) {
  try {
    await feishuRequest(
      `/im/v1/chats/${ChatIdSchema.parse(chatId)}`,
      z.object({ code: z.literal(0) }),
      { token, method: 'DELETE' }
    );
  } catch (error) {
    if (!isDisbandedFeishuHandoffChat(error)) throw error;
  }
}
