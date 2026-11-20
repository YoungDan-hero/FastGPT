import type { OpenAPIPath } from '../../../type';
import {
  FeishuHandoffBodySchema,
  FeishuHandoffConfigBodySchema,
  FeishuHandoffConfigQuerySchema,
  FeishuHandoffConfigResponseSchema,
  FeishuHandoffGroupMutationSchema,
  FeishuHandoffGroupsResponseSchema,
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
          description: '应用配置和可选客服组',
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
