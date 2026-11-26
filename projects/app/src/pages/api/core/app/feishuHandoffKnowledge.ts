import type { ApiRequestProps, ApiResponseType } from '@fastgpt/next/type';
import {
  FeishuHandoffKnowledgeListSchema,
  FeishuHandoffKnowledgeQuerySchema,
  FeishuHandoffKnowledgeReviewSchema
} from '@fastgpt/global/openapi/core/app/feishuHandoff/api';
import { UserError } from '@fastgpt/global/common/error/utils';
import { parseApiInput } from '@fastgpt/service/common/zod/requestParseError';
import {
  authFeishuHandoffReviewApp,
  listFeishuHandoffKnowledge,
  reviewFeishuHandoffKnowledge
} from '@fastgpt/service/core/app/feishuHandoff/review';
import { authUserPer } from '@fastgpt/service/support/permission/user/auth';
import { getFeishuCompanyTeamId } from '@fastgpt/service/support/user/feishu/member';
import { NextAPI } from '@/service/middleware/entry';

export async function handler(req: ApiRequestProps, res: ApiResponseType) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();
  const review =
    req.method === 'POST'
      ? parseApiInput({ req, bodySchema: FeishuHandoffKnowledgeReviewSchema }).body
      : undefined;
  const { teamId, tmbId, isRoot, tmb } = await authUserPer({ req, authToken: true });
  if (teamId !== (await getFeishuCompanyTeamId())) {
    throw new UserError('此团队无法审核客服问答');
  }
  res.setHeader('Cache-Control', 'no-store');
  const actor = { teamId, tmbId, isRoot, tmbInfo: tmb };
  if (review) {
    const app = await authFeishuHandoffReviewApp(review.appId, actor);
    await reviewFeishuHandoffKnowledge({ request: review, appName: app.name, actor });
    return;
  }
  const { appId } = parseApiInput({ req, querySchema: FeishuHandoffKnowledgeQuerySchema }).query;
  return FeishuHandoffKnowledgeListSchema.parse(await listFeishuHandoffKnowledge({ appId, actor }));
}

export default NextAPI(handler);
