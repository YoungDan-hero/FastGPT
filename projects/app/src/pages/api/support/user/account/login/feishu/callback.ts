import type { ApiRequestProps, ApiResponseType } from '@fastgpt/next/type';
import { AuditEventEnum } from '@fastgpt/global/support/user/audit/constants';
import { FeishuOrgLoginCallbackQuerySchema } from '@fastgpt/global/openapi/support/user/account/login/api';
import { parseApiInput } from '@fastgpt/service/common/zod/requestParseError';
import { getLogger, LogCategories } from '@fastgpt/service/common/logger';
import { getClientIpFromRequest } from '@fastgpt/service/common/security/clientIp';
import { assertUserCanLogin } from '@fastgpt/service/support/user/account/cancellation/guard';
import { addAuditLog } from '@fastgpt/service/support/user/audit/util';
import { createUserSession } from '@fastgpt/service/support/user/session';
import { setCookie } from '@fastgpt/service/support/permission/auth/common';
import {
  getFeishuOrgCredentials,
  getFeishuLoginOpenId,
  getFeishuTenantToken
} from '@fastgpt/service/support/user/feishu/client';
import {
  isActiveFeishuEmployee,
  readFeishuEmployee
} from '@fastgpt/service/support/user/feishu/directory';
import { getFeishuLoginMember } from '@fastgpt/service/support/user/feishu/member';
import {
  consumeFeishuOauth,
  feishuOauthCookie,
  getFeishuOauthUrls
} from '@fastgpt/service/support/user/feishu/oauth';
import { NextAPI } from '@/service/middleware/entry';

const logger = getLogger(LogCategories.MODULE.USER.ACCOUNT);

async function handler(req: ApiRequestProps, res: ApiResponseType) {
  if (req.method !== 'GET') return res.status(405).end();
  const { appId } = getFeishuOrgCredentials();
  const { base, redirectUri, stateCookie } = getFeishuOauthUrls();
  const expiredState = stateCookie('');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Set-Cookie', expiredState);
  try {
    const { code, state } = parseApiInput({
      req,
      querySchema: FeishuOrgLoginCallbackQuerySchema
    }).query;
    const oauth = state && (await consumeFeishuOauth(appId, state, req.cookies[feishuOauthCookie]));
    if (!code || !oauth) throw new Error('Invalid or expired Feishu OAuth state');
    const openId = await getFeishuLoginOpenId({ code, verifier: oauth.verifier, redirectUri });
    const actor = await getFeishuLoginMember(appId, openId);
    const employee = await readFeishuEmployee(openId, await getFeishuTenantToken());
    if (!isActiveFeishuEmployee(employee)) throw new Error('Inactive Feishu employee');
    await assertUserCanLogin(actor.userId);
    const token = await createUserSession({
      ...actor,
      isRoot: false,
      ip: getClientIpFromRequest(req)
    });

    setCookie(res, token);
    res.setHeader('Set-Cookie', [String(res.getHeader('Set-Cookie')), expiredState]);
    void addAuditLog({ teamId: actor.teamId, tmbId: actor.tmbId, event: AuditEventEnum.LOGIN });
    res.redirect(303, oauth.returnPath);
  } catch (error) {
    logger.warn('Feishu login failed', {
      reason: error instanceof Error ? error.message : 'Account access denied'
    });
    res.redirect(303, `${base}/login?feishuError=1`);
  }
}

export default NextAPI(handler, { redactQueryParams: ['code', 'state'] });
