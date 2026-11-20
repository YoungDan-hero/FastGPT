import { createHash, randomBytes } from 'node:crypto';
import { isIPv4 } from 'node:net';
import { serialize } from 'cookie';
import { asRedisLogicalKey, redisCacheAdapter } from '@fastgpt/dal/redis/adapter';
import { getSystemInstanceConfig } from '../../../common/system/systemInstanceConfig/runtime';
import { serviceEnv } from '../../../env';
import { feishuDatasetReadScope } from './datasetAccess';

const oauthTtlMs = 5 * 60_000;
export const feishuOauthCookie = 'fastgpt_feishu_state';

export function getFeishuOauthUrls(requestHost?: string) {
  // 内网联调使用明确配置的来源，不能根据请求头生成任意回调地址。
  const devLanSite = (() => {
    if (process.env.NODE_ENV !== 'development' || !serviceEnv.FEISHU_ORG_DEV_LAN_ORIGIN) return;

    const url = new URL(serviceEnv.FEISHU_ORG_DEV_LAN_ORIGIN);
    if (
      url.protocol !== 'http:' ||
      url.host !== requestHost ||
      url.href !== `${url.origin}/` ||
      !isIPv4(url.hostname)
    ) {
      return;
    }

    const [first, second] = url.hostname.split('.').map(Number);
    const isPrivate =
      first === 10 ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168);
    if (isPrivate) return url;
  })();
  const site = devLanSite ?? new URL(getSystemInstanceConfig().site.publicUrl);
  const secure = site.protocol === 'https:';
  if (
    !secure &&
    !devLanSite &&
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
  redirectUri,
  datasetAccessMemberId
}: {
  appId: string;
  returnPath: string;
  redirectUri: string;
  datasetAccessMemberId?: string;
}) {
  const state = randomBytes(32).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(verifier).digest('base64url');
  await redisCacheAdapter.set({
    key: asRedisLogicalKey(`feishu-oauth:${appId}:${state}`),
    value: JSON.stringify({ verifier, returnPath, datasetAccessMemberId }),
    ttlMs: oauthTtlMs
  });
  const authorization = new URL('https://accounts.feishu.cn/open-apis/authen/v1/authorize');
  authorization.search = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    ...(datasetAccessMemberId && { scope: feishuDatasetReadScope })
  }).toString();
  return { state, authorization: authorization.toString() };
}

export async function consumeFeishuOauth(appId: string, state: string, browserState?: string) {
  if (state !== browserState) return;
  const saved = await redisCacheAdapter.getAndDelete(
    asRedisLogicalKey(`feishu-oauth:${appId}:${state}`)
  );
  return saved
    ? (JSON.parse(saved) as {
        verifier: string;
        returnPath: string;
        datasetAccessMemberId?: string;
      })
    : undefined;
}
