import { NextAPI } from '@/service/middleware/entry';
import { ReadPermissionVal, WritePermissionVal } from '@fastgpt/global/support/permission/constant';
import { getApiDatasetRequest } from '@fastgpt/service/core/dataset/apiDataset';
import { assertCanImportFeishuSource } from '@fastgpt/service/core/dataset/apiDataset/auth';
import { authDataset } from '@fastgpt/service/support/permission/dataset/auth';
import type { ApiRequestProps } from '@fastgpt/next/type';
import { parseApiInput } from '@fastgpt/service/common/zod/requestParseError';
import {
  GetApiDatasetFileListBodySchema,
  GetApiDatasetFileListResponseSchema,
  type GetApiDatasetFileListBody,
  type GetApiDatasetFileListResponse
} from '@fastgpt/global/openapi/core/dataset/apiDataset/api';
import { createDatasetCache } from '@fastgpt/service/support/tmpData/datasetCache';

// 仅用于选文件时的浏览快照；正式导入、同步调用 factory 时不注入共享缓存。
const browseCache = createDatasetCache({ namespace: 'api-dataset-browse', ttlMs: 3 * 60 * 1000 });

async function handler(
  req: ApiRequestProps<GetApiDatasetFileListBody>
): Promise<GetApiDatasetFileListResponse> {
  const {
    datasetId,
    searchKey = '',
    parentId,
    feishuSourceUrl
  } = parseApiInput({ req, bodySchema: GetApiDatasetFileListBodySchema }).body;

  const { dataset, authType, tmbId } = await authDataset({
    req,
    authToken: true,
    authApiKey: true,
    datasetId,
    per: feishuSourceUrl ? WritePermissionVal : ReadPermissionVal
  });
  if (feishuSourceUrl) assertCanImportFeishuSource({ dataset, authType, tmbId });

  const files = await (
    await getApiDatasetRequest(dataset.apiDatasetServer, {
      cache: browseCache,
      feishuSourceUrl,
      feishuActor: { teamId: String(dataset.teamId), tmbId: String(dataset.tmbId) }
    })
  ).listFiles({ searchKey: searchKey, parentId });

  return GetApiDatasetFileListResponseSchema.parse(files);
}

export default NextAPI(handler);
