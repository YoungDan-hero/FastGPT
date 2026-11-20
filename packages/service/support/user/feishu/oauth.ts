import { createHash, randomBytes } from 'node:crypto';
import { serialize } from 'cookie';
import { asRedisLogicalKey, redisCacheAdapter } from '@fastgpt/dal/redis/adapter';
import { getSystemInstanceConfig } from '../../../common/system/systemInstanceConfig/runtime';
import { serviceEnv } from '../../../env';

const oauthTtlMs = 5 * 60_000;
export const feishuOauthCookie = 'fastgpt_feishu_state';

export function getFeishuOauthUrls() {
  const site = new URL(getSystemInstanceConfig().site.publicUrl);
  const secure = site.protocol === 'https:';
  if (
    !secure &&
    !(site.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(site.hostname))
  ) {
    throw new Error('Feishu OAuth needs an HTTPS site URL or HTTP loopback');
  }
  const base = serviceEnv.NEXT_PUBLIC_BASE_URL;
  const callbackPath = `${base}/api/support/user/account/login/feishu/callback`;
  return {
    base,
    redirectUri: new URL(callbackPath, site.origin).toString(),
    stateCookie: (state: string) =>
      serialize(feishuOauthCookie, state, {
        httpOnly: true,
        sameSite: 'lax',
        secure,
        path: callbackPath,
        maxAge: state ? oauthTtlMs / 1000 : 0
      })
  };
}

export function safeFeishuReturnPath(path: string | undefined, base: string) {
  const fallback = `${base}/dashboard/agent`;
  if (!path || !path.startsWith('/') || path.startsWith('//') || /[\\\s]/.test(path)) {
    return fallback;
  }
  try {
    const origin = 'https://fastgpt.invalid';
    const url = new URL(path, origin);
    if (url.origin !== origin) return fallback;
    const pathname =
      base && !url.pathname.startsWith(`${base}/`) ? `${base}${url.pathname}` : url.pathname;
    const route = pathname.slice(base.length);
    if (!/^\/(dashboard|chat|account|app)(\/|$)/.test(route)) return fallback;
    return `${pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

export async function startFeishuOauth({
  appId,
  returnPath,
  redirectUri
}: {
  appId: string;
  returnPath: string;
  redirectUri: string;
}) {
  const state = randomBytes(32).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(verifier).digest('base64url');
  await redisCacheAdapter.set({
    key: asRedisLogicalKey(`feishu-oauth:${appId}:${state}`),
    value: JSON.stringify({ verifier, returnPath }),
    ttlMs: oauthTtlMs
  });
  const authorization = new URL('https://accounts.feishu.cn/open-apis/authen/v1/authorize');
  authorization.search = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256'
  }).toString();
  return { state, authorization: authorization.toString() };
}

export async function consumeFeishuOauth(appId: string, state: string, browserState?: string) {
  if (state !== browserState) return;
  const saved = await redisCacheAdapter.getAndDelete(
    asRedisLogicalKey(`feishu-oauth:${appId}:${state}`)
  );
  return saved ? (JSON.parse(saved) as { verifier: string; returnPath: string }) : undefined;
}
