import { useApiDatasetRequest } from './custom/api';
import { useYuqueDatasetRequest } from './yuqueDataset/api';
import { useFeishuDatasetRequest } from './feishuDataset/api';
import { useFeishuLinkDatasetRequest } from './feishuDataset/link';
import { useDingtalkDatasetRequest } from './dingtalkDataset/api';
import type { ApiDatasetServerType } from '@fastgpt/global/core/dataset/apiDataset/type';
import type { AsyncCache } from '../../../common/cache/type';
import type { FeishuDatasetActor } from '../../../support/user/feishu/datasetAccess';
import { UserError } from '@fastgpt/global/common/error/utils';

export type ApiDatasetRequestOptions = {
  cache?: AsyncCache;
  feishuActor?: FeishuDatasetActor;
  feishuSourceUrl?: string;
};

/** 浏览入口可注入短期快照缓存；导入和同步不传缓存，保持本轮远端数据新鲜。 */
export const getApiDatasetRequest = async (
  apiDatasetServer?: ApiDatasetServerType,
  options: ApiDatasetRequestOptions = {}
) => {
  const { apiServer, yuqueServer, feishuServer, feishuApp, feishuLink, dingtalkServer } =
    apiDatasetServer ?? {};

  const url = options.feishuSourceUrl ?? feishuLink?.url;
  if (url) {
    // 员工凭据只能通过已鉴权的库获取，不接受请求体里的身份信息。
    if (!options.feishuActor) throw new UserError('Missing Feishu dataset owner');
    const app = feishuApp ?? feishuLink;
    return useFeishuLinkDatasetRequest({ ...app, url }, options.feishuActor);
  }

  if (apiServer) {
    return useApiDatasetRequest({ apiServer });
  }
  if (yuqueServer) {
    return useYuqueDatasetRequest({ yuqueServer, cache: options.cache });
  }
  if (feishuServer) {
    return useFeishuDatasetRequest({ feishuServer });
  }
  if (dingtalkServer) {
    return useDingtalkDatasetRequest({ dingtalkServer });
  }
  if (feishuApp) throw new UserError('Missing Feishu source link', '请先填写要导入的飞书链接。');
  return Promise.reject('Can not find api dataset server');
};
