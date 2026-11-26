import { GET, POST } from '@/web/common/api/request';
import type {
  FeishuHandoffBody,
  FeishuHandoffConfigBody,
  FeishuHandoffConfigResponse,
  FeishuHandoffDatasetKnowledgePage,
  FeishuHandoffDatasetKnowledgeQuery,
  FeishuHandoffGroupMutation,
  FeishuHandoffGroupsResponse,
  FeishuHandoffKnowledgeCounts,
  FeishuHandoffKnowledgeCountsBody,
  FeishuHandoffKnowledgeList,
  FeishuHandoffKnowledgeReview,
  FeishuHandoffResponse
} from '@fastgpt/global/openapi/core/app/feishuHandoff/api';

export const getFeishuHandoffGroups = () =>
  GET<FeishuHandoffGroupsResponse>('/support/user/team/feishu/handoffGroups');

export const updateFeishuHandoffGroup = (body: FeishuHandoffGroupMutation) =>
  POST('/support/user/team/feishu/handoffGroups', body);

export const getFeishuHandoffConfig = (appId: string) =>
  GET<FeishuHandoffConfigResponse>('/core/app/feishuHandoff', { appId });

export const updateFeishuHandoffConfig = (body: FeishuHandoffConfigBody) =>
  POST('/core/app/feishuHandoff', body);

export const getFeishuHandoffKnowledge = (appId?: string) =>
  GET<FeishuHandoffKnowledgeList>(
    '/core/app/feishuHandoffKnowledge',
    appId ? { appId } : undefined
  );

export const getDatasetFeishuHandoffKnowledge = (query: FeishuHandoffDatasetKnowledgeQuery) =>
  GET<FeishuHandoffDatasetKnowledgePage>('/core/dataset/feishuHandoffKnowledge', query);

export const getFeishuHandoffKnowledgeCounts = (body: FeishuHandoffKnowledgeCountsBody) =>
  POST<FeishuHandoffKnowledgeCounts>('/core/dataset/feishuHandoffKnowledge', body);

export const submitFeishuHandoffKnowledgeReview = (body: FeishuHandoffKnowledgeReview) =>
  POST('/core/app/feishuHandoffKnowledge', body);

export const postFeishuHandoff = (body: FeishuHandoffBody) =>
  POST<FeishuHandoffResponse>('/core/chat/feishuHandoff', body);
