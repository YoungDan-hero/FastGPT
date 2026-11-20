import { NextAPI } from '@/service/middleware/entry';
import {
  PushDataBodySchema,
  type PushDataResponseType
} from '@fastgpt/global/openapi/core/dataset/data/api';
import { WritePermissionVal } from '@fastgpt/global/support/permission/constant';
import type { ApiRequestProps } from '@fastgpt/next/type';
import { pushDatasetData } from '@fastgpt/service/core/dataset/data/pushData';
import { authDatasetCollection } from '@fastgpt/service/support/permission/dataset/auth';
import { parseApiInput } from '@fastgpt/service/common/zod/requestParseError';

async function handler(req: ApiRequestProps): Promise<PushDataResponseType> {
  const body = parseApiInput({ req, bodySchema: PushDataBodySchema }).body;
  const actor = await authDatasetCollection({
    req,
    authToken: true,
    authApiKey: true,
    collectionId: body.collectionId,
    per: WritePermissionVal
  });
  return pushDatasetData(body, actor);
}

export default NextAPI(handler);

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb'
    },
    responseLimit: '12mb'
  }
};
