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

export async function feishuRequest<T extends z.ZodType>(
  path: string,
  schema: T,
  { token, body }: { token?: string; body?: Record<string, string> } = {}
): Promise<z.infer<T>> {
  const response = await fetch(`${api}${path}`, {
    method: body ? 'POST' : 'GET',
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
    headers: {
      ...(token && { Authorization: `Bearer ${token}` }),
      ...(body && { 'Content-Type': 'application/json' })
    },
    body: body && JSON.stringify(body)
  });
  const json: unknown = await response.json().catch(() => undefined);
  const endpoint = path.split('?')[0].replace(/\/(?:ou_|od-)[^/]+/g, '/:id');
  const envelope = z.object({ code: z.number() }).safeParse(json);
  if (!response.ok || !envelope.success || envelope.data.code !== 0) {
    throw new Error(
      `Feishu ${endpoint} returned ${envelope.success ? envelope.data.code : response.status}`
    );
  }
  const result = schema.safeParse(json);
  if (!result.success) {
    const fields = result.error.issues.map(({ path }) => path.join('.'));
    throw new Error(`Unexpected Feishu fields for ${endpoint}: ${fields.join(', ')}`);
  }
  return result.data;
}

export async function getFeishuTenantToken() {
  const { appId, secret } = getFeishuOrgCredentials();
  const result = await feishuRequest(
    '/auth/v3/tenant_access_token/internal',
    z.object({ tenant_access_token: z.string().min(1) }),
    { body: { app_id: appId, app_secret: secret } }
  );
  return result.tenant_access_token;
}

export async function getFeishuLoginOpenId({
  code,
  verifier,
  redirectUri
}: {
  code: string;
  verifier: string;
  redirectUri: string;
}) {
  const { appId, secret } = getFeishuOrgCredentials();
  const { access_token } = await feishuRequest(
    '/authen/v2/oauth/token',
    z.object({ access_token: z.string().min(1) }),
    {
      body: {
        grant_type: 'authorization_code',
        client_id: appId,
        client_secret: secret,
        code,
        code_verifier: verifier,
        redirect_uri: redirectUri
      }
    }
  );
  const { data } = await feishuRequest(
    '/authen/v1/user_info',
    z.object({ data: z.object({ open_id: z.string().regex(/^ou_[A-Za-z0-9_-]+$/) }) }),
    { token: access_token }
  );
  return data.open_id;
}
