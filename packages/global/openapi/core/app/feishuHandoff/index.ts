import type { OpenAPIPath } from '../../../type';
import {
  FeishuHandoffBodySchema,
  FeishuHandoffConfigBodySchema,
  FeishuHandoffConfigQuerySchema,
  FeishuHandoffConfigResponseSchema,
  FeishuHandoffDatasetKnowledgePageSchema,
  FeishuHandoffDatasetKnowledgeQuerySchema,
  FeishuHandoffGroupMutationSchema,
  FeishuHandoffGroupsResponseSchema,
  FeishuHandoffKnowledgeCountsBodySchema,
  FeishuHandoffKnowledgeCountsSchema,
  FeishuHandoffKnowledgeListSchema,
  FeishuHandoffKnowledgeQuerySchema,
  FeishuHandoffKnowledgeReviewSchema,
  FeishuHandoffResponseSchema
} from './api';

export const FeishuHandoffPath: OpenAPIPath = {
  '/support/user/team/feishu/handoffGroups': {
    get: {
      summary: '获取飞书客服组和已同步的飞书员工',
      tags: ['Admin', 'App'],
      responses: {
        200: {
          description: '客服组、员工名单和机器人配置状态',
          content: { 'application/json': { schema: FeishuHandoffGroupsResponseSchema } }
        }
      }
    },
    post: {
      summary: '保存或删除飞书客服组',
      tags: ['Admin', 'App'],
      requestBody: {
        content: { 'application/json': { schema: FeishuHandoffGroupMutationSchema } }
      },
      responses: { 200: { description: '操作成功' } }
    }
  },
  '/core/app/feishuHandoff': {
    get: {
      summary: '获取应用的飞书转人工配置',
      tags: ['App'],
      requestParams: { query: FeishuHandoffConfigQuerySchema },
      responses: {
        200: {
          description: '应用转人工、自动解散与沉淀配置，以及可选客服组',
          content: { 'application/json': { schema: FeishuHandoffConfigResponseSchema } }
        }
      }
    },
    post: {
      summary: '保存应用的飞书转人工配置',
      tags: ['App'],
      requestBody: { content: { 'application/json': { schema: FeishuHandoffConfigBodySchema } } },
      responses: { 200: { description: '配置已保存' } }
    }
  },
  '/core/app/feishuHandoffKnowledge': {
    get: {
      summary: '列出当前成员可审核的客服沉淀问答，可按应用筛选',
      tags: ['App', 'Dataset'],
      requestParams: { query: FeishuHandoffKnowledgeQuerySchema },
      responses: {
        200: {
          description: '待审核问答、来源应用、目标知识库及客服答复证据',
          content: { 'application/json': { schema: FeishuHandoffKnowledgeListSchema } }
        }
      }
    },
    post: {
      summary: '审核并发布或驳回客服沉淀问答',
      tags: ['App', 'Dataset'],
      requestBody: {
        content: { 'application/json': { schema: FeishuHandoffKnowledgeReviewSchema } }
      },
      responses: { 200: { description: '审核结果已保存' } }
    }
  },
  '/core/dataset/feishuHandoffKnowledge': {
    get: {
      summary: '列出当前知识库的待审核客服问答',
      tags: ['Dataset', 'App'],
      requestParams: { query: FeishuHandoffDatasetKnowledgeQuerySchema },
      responses: {
        200: {
          description: '单库待审核问答的分页结果和待审集合选项',
          content: { 'application/json': { schema: FeishuHandoffDatasetKnowledgePageSchema } }
        }
      }
    },
    post: {
      summary: '按知识库统计待审核客服问答数',
      tags: ['Dataset', 'App'],
      requestBody: {
        content: { 'application/json': { schema: FeishuHandoffKnowledgeCountsBodySchema } }
      },
      responses: {
        200: {
          description: '有可审核问答的知识库及其待审数量',
          content: { 'application/json': { schema: FeishuHandoffKnowledgeCountsSchema } }
        }
      }
    }
  },
  '/core/chat/feishuHandoff': {
    post: {
      summary: '将所选问答转给飞书客服',
      tags: ['Chat', 'App'],
      requestBody: { content: { 'application/json': { schema: FeishuHandoffBodySchema } } },
      responses: {
        200: {
          description: '飞书客服群入口',
          content: { 'application/json': { schema: FeishuHandoffResponseSchema } }
        }
      }
    }
  }
};
