import { GET, POST } from '@/web/common/api/request';
import type {
  FeishuHandoffBody,
  FeishuHandoffConfigBody,
  FeishuHandoffConfigResponse,
  FeishuHandoffGroupMutation,
  FeishuHandoffGroupsResponse,
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

export const postFeishuHandoff = (body: FeishuHandoffBody) =>
  POST<FeishuHandoffResponse>('/core/chat/feishuHandoff', body);
