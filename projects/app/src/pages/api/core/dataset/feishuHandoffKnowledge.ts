import type { ApiRequestProps, ApiResponseType } from '@fastgpt/next/type';
import { UserError } from '@fastgpt/global/common/error/utils';
import {
  FeishuHandoffDatasetKnowledgePageSchema,
  FeishuHandoffDatasetKnowledgeQuerySchema,
  FeishuHandoffKnowledgeCountsBodySchema,
  FeishuHandoffKnowledgeCountsSchema
} from '@fastgpt/global/openapi/core/app/feishuHandoff/api';
import { normalizePagination } from '@fastgpt/service/common/api/pagination';
import { parseApiInput } from '@fastgpt/service/common/zod/requestParseError';
import {
  countFeishuHandoffKnowledgeByDataset,
  listDatasetFeishuHandoffKnowledge
} from '@fastgpt/service/core/app/feishuHandoff/review';
import { authUserPer } from '@fastgpt/service/support/permission/user/auth';
import { getFeishuCompanyTeamId } from '@fastgpt/service/support/user/feishu/member';
import { NextAPI } from '@/service/middleware/entry';

export async function handler(req: ApiRequestProps, res: ApiResponseType) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();

  const { teamId, tmbId, isRoot, tmb } = await authUserPer({ req, authToken: true });
  if (teamId !== (await getFeishuCompanyTeamId())) {
    throw new UserError('此团队无法审核客服问答');
  }
  const actor = { teamId, tmbId, isRoot, tmbInfo: tmb };
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'POST') {
    const { datasetIds } = parseApiInput({
      req,
      bodySchema: FeishuHandoffKnowledgeCountsBodySchema
    }).body;
    return FeishuHandoffKnowledgeCountsSchema.parse(
      await countFeishuHandoffKnowledgeByDataset({ datasetIds, actor })
    );
  }

  const query = parseApiInput({ req, querySchema: FeishuHandoffDatasetKnowledgeQuerySchema }).query;
  return FeishuHandoffDatasetKnowledgePageSchema.parse(
    await listDatasetFeishuHandoffKnowledge({
      datasetId: query.datasetId,
      targetCollectionId: query.targetCollectionId,
      ...normalizePagination(query),
      actor
    })
  );
}

export default NextAPI(handler);
