import { z } from 'zod';
import { feishuRequest } from '../../../support/user/feishu/client';
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
  uuid
}: {
  token: string;
  chatId: string;
  content: string;
  uuid: string;
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
          header: { title: { tag: 'plain_text', content: '人工客服交接' }, template: 'blue' },
          body: { elements: [{ tag: 'div', text: { tag: 'plain_text', content } }] }
        })
      }
    }
  );
}
