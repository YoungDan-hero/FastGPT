import { z } from 'zod';
import { ObjectIdSchema } from '../../../../common/type/mongo';
import { FeishuHandoffConfigSchema } from '../../../../core/app/feishuHandoff';
import { ChatIdSchema } from '../../../../core/chat/schema';
import { OutLinkChatAuthSchema } from '../../../../support/permission/chat';

/**
 * API: 管理飞书客服组
 * Route: /api/support/user/team/feishu/handoffGroups
 * Method: GET, POST
 * Description: 系统管理员从飞书通讯录维护企业客服组。
 * Tags: ['Admin', 'App']
 */
const GroupNameSchema = z.string().trim().min(1).max(40);
const GroupMemberIdsSchema = z.array(ObjectIdSchema).min(1).max(49);
const GroupSummarySchema = z.object({ id: ObjectIdSchema, name: GroupNameSchema });
const HandoffGroupSchema = GroupSummarySchema.extend({ memberIds: GroupMemberIdsSchema });

export const FeishuHandoffGroupsResponseSchema = z.object({
  botConfigured: z.boolean(),
  groups: z.array(HandoffGroupSchema),
  members: z.array(z.object({ id: ObjectIdSchema, name: z.string() }))
});
export type FeishuHandoffGroupsResponse = z.infer<typeof FeishuHandoffGroupsResponseSchema>;

export const FeishuHandoffGroupMutationSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('save'),
    id: ObjectIdSchema.optional(),
    name: GroupNameSchema,
    memberIds: GroupMemberIdsSchema.transform((ids) => [...new Set(ids)])
  }),
  z.object({ action: z.literal('delete'), id: ObjectIdSchema })
]);
export type FeishuHandoffGroupMutation = z.infer<typeof FeishuHandoffGroupMutationSchema>;

/**
 * API: 应用人工客服配置
 * Route: /api/core/app/feishuHandoff
 * Method: GET, POST
 * Description: 读取或保存应用的飞书转人工开关及接待客服组。
 * Tags: ['App']
 */
export const FeishuHandoffConfigQuerySchema = z.object({ appId: ObjectIdSchema });
export type FeishuHandoffConfigQuery = z.infer<typeof FeishuHandoffConfigQuerySchema>;

export const FeishuHandoffConfigBodySchema = FeishuHandoffConfigQuerySchema.extend({
  config: FeishuHandoffConfigSchema
});
export type FeishuHandoffConfigBody = z.infer<typeof FeishuHandoffConfigBodySchema>;

export const FeishuHandoffConfigResponseSchema = z.object({
  botConfigured: z.boolean(),
  groups: z.array(GroupSummarySchema),
  config: FeishuHandoffConfigSchema
});
export type FeishuHandoffConfigResponse = z.infer<typeof FeishuHandoffConfigResponseSchema>;

/**
 * API: 转飞书人工客服
 * Route: /api/core/chat/feishuHandoff
 * Method: POST
 * Description: 已登录的员工确认后只转发本人会话中所选的一轮问答。旧请求缺省时按最近一轮处理。
 * Tags: ['Chat', 'App']
 */
export const FeishuHandoffBodySchema = z
  .object({
    appId: ObjectIdSchema.optional(),
    chatId: ChatIdSchema.min(1),
    outLinkAuthData: OutLinkChatAuthSchema.optional(),
    turn: z
      .object({
        questionId: ChatIdSchema.min(1).describe('所选用户提问的消息 ID'),
        answerId: ChatIdSchema.min(1).optional().describe('同轮 AI 回答的消息 ID')
      })
      .optional(),
    note: z.string().trim().max(500).optional(),
    confirmed: z.literal(true)
  })
  .refine(({ appId, outLinkAuthData }) => Boolean(appId ?? outLinkAuthData), {
    path: ['appId'],
    message: '需要应用 ID 或分享会话身份'
  });
export type FeishuHandoffBody = z.infer<typeof FeishuHandoffBodySchema>;
export type FeishuHandoffTurn = NonNullable<FeishuHandoffBody['turn']>;

export const FeishuHandoffResponseSchema = z.object({
  chatUrl: z.url(),
  groupName: GroupNameSchema,
  reused: z.boolean()
});
export type FeishuHandoffResponse = z.infer<typeof FeishuHandoffResponseSchema>;
