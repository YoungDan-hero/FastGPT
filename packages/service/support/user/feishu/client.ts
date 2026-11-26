import { z } from 'zod';
import { serviceEnv } from '../../../env';

const api = 'https://open.feishu.cn/open-apis';

export function getFeishuOrgCredentials() {
  const { FEISHU_ORG_ENABLED, FEISHU_ORG_APP_ID, FEISHU_ORG_APP_SECRET } = serviceEnv;
  if (!FEISHU_ORG_ENABLED || !FEISHU_ORG_APP_ID || !FEISHU_ORG_APP_SECRET) {
    throw new Error('Feishu organization login is not configured');
  }
  return { appId: FEISHU_ORG_APP_ID, secret: FEISHU_ORG_APP_SECRET };
}

export class FeishuRequestError extends Error {
  constructor(
    endpoint: string,
    readonly code: number
  ) {
    super(`Feishu ${endpoint} returned ${code}`);
  }
}

export async function feishuRequest<T extends z.ZodType>(
  path: string,
  schema: T,
  {
    token,
    body,
    method
  }: { token?: string; body?: Record<string, unknown>; method?: 'DELETE' } = {}
): Promise<z.infer<T>> {
  const response = await fetch(`${api}${path}`, {
    method: method ?? (body ? 'POST' : 'GET'),
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
    headers: {
      ...(token && { Authorization: `Bearer ${token}` }),
      ...(body && { 'Content-Type': 'application/json' })
    },
    body: body && JSON.stringify(body)
  });
  const json: unknown = await response.json().catch(() => undefined);
  const endpoint = path.split('?')[0].replace(/\/(?:ou_|on_|oc_|od-)[^/]+/g, '/:id');
  const envelope = z.object({ code: z.number() }).safeParse(json);
  if (!response.ok || !envelope.success || envelope.data.code !== 0) {
    throw new FeishuRequestError(endpoint, envelope.success ? envelope.data.code : response.status);
  }
  const result = schema.safeParse(json);
  if (!result.success) {
    const fields = result.error.issues.map(({ path }) => path.join('.'));
    throw new Error(`Unexpected Feishu fields for ${endpoint}: ${fields.join(', ')}`);
  }
  return result.data;
}

export async function getFeishuTenantToken({ appId, secret } = getFeishuOrgCredentials()) {
  const result = await feishuRequest(
    '/auth/v3/tenant_access_token/internal',
    z.object({ tenant_access_token: z.string().min(1) }),
    { body: { app_id: appId, app_secret: secret } }
  );
  return result.tenant_access_token;
}

const FeishuUserTokenSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  refresh_token: z.string().min(1).optional(),
  refresh_token_expires_in: z.number().int().nonnegative().optional()
});
export type FeishuUserToken = z.infer<typeof FeishuUserTokenSchema>;

/** 换取用户凭据，应用密钥只在服务端使用。 */
export async function requestFeishuUserToken(grant: Record<string, string>) {
  const { appId, secret } = getFeishuOrgCredentials();
  return feishuRequest('/authen/v2/oauth/token', FeishuUserTokenSchema, {
    body: { ...grant, client_id: appId, client_secret: secret }
  });
}

/** 查验授权账号，并返回本次授权的凭据供文档读取流程使用。 */
export async function getFeishuLoginAccount({
  code,
  verifier,
  redirectUri
}: {
  code: string;
  verifier: string;
  redirectUri: string;
}) {
  const credentials = await requestFeishuUserToken({
    grant_type: 'authorization_code',
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri
  });
  const { data } = await feishuRequest(
    '/authen/v1/user_info',
    z.object({ data: z.object({ open_id: z.string().regex(/^ou_[A-Za-z0-9_-]+$/) }) }),
    { token: credentials.access_token }
  );
  return { openId: data.open_id, credentials };
}
