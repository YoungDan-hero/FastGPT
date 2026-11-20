import type { ApiRequestProps, ApiResponseType } from '@fastgpt/next/type';
import { FeishuOrgLoginStartQuerySchema } from '@fastgpt/global/openapi/support/user/account/login/api';
import { parseApiInput } from '@fastgpt/service/common/zod/requestParseError';
import { getFeishuOrgCredentials } from '@fastgpt/service/support/user/feishu/client';
import {
  getFeishuOauthUrls,
  safeFeishuReturnPath,
  startFeishuOauth
} from '@fastgpt/service/support/user/feishu/oauth';
import { NextAPI } from '@/service/middleware/entry';
import { authCert } from '@fastgpt/service/support/permission/auth/common';

async function handler(req: ApiRequestProps, res: ApiResponseType) {
  if (req.method !== 'GET') return res.status(405).end();
  const { lastRoute, datasetAccess } = parseApiInput({
    req,
    querySchema: FeishuOrgLoginStartQuerySchema
  }).query;
  const { appId } = getFeishuOrgCredentials();
  const { base, redirectUri, stateCookie } = getFeishuOauthUrls(req.headers?.host);
  const actor = datasetAccess ? await authCert({ req, authToken: true }) : undefined;
  const { state, authorization } = await startFeishuOauth({
    appId,
    redirectUri,
    returnPath: safeFeishuReturnPath(lastRoute, base),
    datasetAccessMemberId: actor?.tmbId
  });
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Set-Cookie', stateCookie(state));
  res.redirect(302, authorization);
}

export default NextAPI(handler);
