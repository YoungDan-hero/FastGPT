import { z } from 'zod';
import { ObjectIdSchema } from '../../../../common/type/mongo';
import { FeishuHandoffConfigSchema } from '../../../../core/app/feishuHandoff';
import { ChatIdSchema } from '../../../../core/chat/schema';
import { IntSchema } from '../../../../common/zod';
import { OutLinkChatAuthSchema } from '../../../../support/permission/chat';
import {
  createPaginationSchema,
  PaginationPageSizeSchema,
  PaginationResponseSchema
} from '../../../api';

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
 * Description: 读取或保存飞书转人工、客服群自动解散参数、沉淀知识库和写入集合。
 * Tags: ['App']
 */
export const FeishuHandoffConfigQuerySchema = z.object({ appId: ObjectIdSchema });
export type FeishuHandoffConfigQuery = z.infer<typeof FeishuHandoffConfigQuerySchema>;

export const FeishuHandoffConfigBodySchema = FeishuHandoffConfigQuerySchema.extend({
  config: FeishuHandoffConfigSchema
}).refine(
  ({ config }) =>
    !config.enabled ||
    !config.knowledgeMining?.enabled ||
    Boolean(config.knowledgeMining.targetCollectionId),
  { path: ['config', 'knowledgeMining', 'targetCollectionId'], message: '请选择写入集合' }
);
export type FeishuHandoffConfigBody = z.infer<typeof FeishuHandoffConfigBodySchema>;

export const FeishuHandoffConfigResponseSchema = z.object({
  botConfigured: z.boolean(),
  groups: z.array(GroupSummarySchema),
  config: FeishuHandoffConfigSchema
});
export type FeishuHandoffConfigResponse = z.infer<typeof FeishuHandoffConfigResponseSchema>;

/**
 * API: 审核客服沉淀问答
 * Route: /api/core/app/feishuHandoffKnowledge
 * Method: GET, POST
 * Description: 列出当前成员可审核的问答，可按应用筛选。审核通过后写入配置的知识库。
 * Tags: ['App', 'Dataset']
 */
const FeishuHandoffKnowledgeAppSchema = z.object({ appId: ObjectIdSchema });
export const FeishuHandoffKnowledgeQuerySchema = FeishuHandoffKnowledgeAppSchema.partial();
export type FeishuHandoffKnowledgeQuery = z.infer<typeof FeishuHandoffKnowledgeQuerySchema>;
const HandoffQuestionSchema = z.string().trim().min(1).max(240);
const HandoffAnswerSchema = z.string().trim().min(1).max(1000);
const KnowledgeDatasetIdSchema = ObjectIdSchema.meta({ description: '问答写入的知识库 ID' });
const ReviewCandidateSchema = FeishuHandoffKnowledgeAppSchema.extend({
  candidateId: ObjectIdSchema,
  datasetId: KnowledgeDatasetIdSchema.optional()
});
export const FeishuHandoffKnowledgeReviewSchema = z.discriminatedUnion('action', [
  ReviewCandidateSchema.extend({
    action: z.literal('publish'),
    question: HandoffQuestionSchema,
    answer: HandoffAnswerSchema
  }),
  ReviewCandidateSchema.extend({
    action: z.literal('reject'),
    reason: z.string().trim().min(1).max(300)
  })
]);
export type FeishuHandoffKnowledgeReview = z.infer<typeof FeishuHandoffKnowledgeReviewSchema>;

const KnowledgeReviewItemSchema = z.object({
  id: ObjectIdSchema,
  appId: ObjectIdSchema,
  appName: z.string(),
  datasetName: z.string(),
  collectionName: z.string().nullable().optional().meta({
    description: '指定集合的名称，null 表示集合不可用，缺省表示使用应用的自动沉淀集合'
  }),
  question: HandoffQuestionSchema,
  answer: HandoffAnswerSchema,
  evidence: z.array(z.string()),
  partialHistory: z.boolean()
});
export const FeishuHandoffKnowledgeListSchema = z.array(KnowledgeReviewItemSchema);
export type FeishuHandoffKnowledgeList = z.infer<typeof FeishuHandoffKnowledgeListSchema>;

/**
 * API: 列出单个知识库的待审核客服问答
 * Route: GET /api/core/dataset/feishuHandoffKnowledge
 * Method: GET
 * Description: 按写入的知识库分页，可筛选目标集合，并返回本库的待审集合选项。
 * Tags: ['Dataset', 'App']
 */
const KnowledgeCollectionFilterSchema = z.union([ObjectIdSchema, z.literal('legacy')]).meta({
  description: '目标集合 ID。legacy 表示尚未指定集合的历史问答'
});
export const FeishuHandoffDatasetKnowledgeQuerySchema = createPaginationSchema({
  datasetId: KnowledgeDatasetIdSchema,
  targetCollectionId: KnowledgeCollectionFilterSchema.optional(),
  pageSize: PaginationPageSizeSchema.overwrite((value) => Math.min(value, 50)).meta({
    example: 20,
    description: '每页条数。默认 20，最大 50'
  })
});
export type FeishuHandoffDatasetKnowledgeQuery = z.infer<
  typeof FeishuHandoffDatasetKnowledgeQuerySchema
>;

export const FeishuHandoffDatasetKnowledgePageSchema = PaginationResponseSchema(
  KnowledgeReviewItemSchema
).extend({
  collections: z
    .array(
      z.object({
        id: KnowledgeCollectionFilterSchema,
        name: z.string().nullable().meta({ description: '集合名称，null 表示集合不可用' })
      })
    )
    .meta({ description: '当前知识库中有待审问答的集合' })
});
export type FeishuHandoffDatasetKnowledgePage = z.infer<
  typeof FeishuHandoffDatasetKnowledgePageSchema
>;

/**
 * API: 批量统计各知识库的待审核客服问答
 * Route: POST /api/core/dataset/feishuHandoffKnowledge
 * Method: POST
 * Description: 仅统计当前成员有权审核的问答，返回有待审记录的知识库。
 * Tags: ['Dataset', 'App']
 */
export const feishuHandoffKnowledgeCountBatchSize = 100;
export const FeishuHandoffKnowledgeCountsBodySchema = z.object({
  datasetIds: z
    .array(KnowledgeDatasetIdSchema)
    .min(1)
    .max(feishuHandoffKnowledgeCountBatchSize)
    .meta({ description: `要统计的知识库 ID，每批最多 ${feishuHandoffKnowledgeCountBatchSize} 个` })
});
export type FeishuHandoffKnowledgeCountsBody = z.infer<
  typeof FeishuHandoffKnowledgeCountsBodySchema
>;

export const FeishuHandoffKnowledgeCountsSchema = z.array(
  z.object({
    datasetId: KnowledgeDatasetIdSchema,
    count: IntSchema.positive().meta({ description: '当前成员可审核的问答数量', example: 3 })
  })
);
export type FeishuHandoffKnowledgeCounts = z.infer<typeof FeishuHandoffKnowledgeCountsSchema>;

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
