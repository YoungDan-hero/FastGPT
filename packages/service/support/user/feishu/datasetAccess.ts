import { z } from 'zod';
import { asRedisLogicalKey, redisCacheAdapter } from '@fastgpt/dal/redis/adapter';
import { LeaseCache, RedisLeaseUnavailableError } from '@fastgpt/dal/redis/caches/lease';
import { UserError } from '@fastgpt/global/common/error/utils';
import { decryptSecret, encryptSecret } from '../../../common/secret/aes256gcm';
import { getFeishuOrgCredentials, requestFeishuUserToken, type FeishuUserToken } from './client';
import { assertFeishuOrgMember } from './member';

export const feishuDatasetReadScope =
  'auth:user.id:read docx:document:readonly bitable:app:readonly wiki:wiki:readonly offline_access';

export type FeishuDatasetActor = { teamId: string; tmbId: string };

const StoredGrantSchema = z.object({
  accessToken: z.string().min(1),
  expiresAt: z.number(),
  refreshToken: z.string().optional()
});

const grantKey = ({ teamId, tmbId }: FeishuDatasetActor) =>
  asRedisLogicalKey(`feishu-dataset:${getFeishuOrgCredentials().appId}:${teamId}:${tmbId}`);
const grantLease = new LeaseCache();
const grantLeaseOptions = (actor: FeishuDatasetActor) => ({
  key: grantKey(actor),
  label: 'Feishu dataset authorization',
  ttlMs: 30_000
});

const authorizationRequired = () =>
  new UserError(
    'Feishu dataset authorization required',
    '请点击「授权读取飞书」，在飞书授权后重试。'
  );

const writeGrant = async (actor: FeishuDatasetActor, grant: FeishuUserToken) => {
  await redisCacheAdapter.set({
    key: grantKey(actor),
    value: encryptSecret(
      JSON.stringify({
        accessToken: grant.access_token,
        expiresAt: Date.now() + grant.expires_in * 1_000,
        refreshToken: grant.refresh_token
      })
    ),
    ttlMs: Math.max(grant.expires_in, grant.refresh_token_expires_in ?? 0) * 1_000
  });
};

/** 用成员标识隔离并加密保存飞书凭据，授权到期后由 Redis 清理。 */
export function saveFeishuDatasetGrant(actor: FeishuDatasetActor, grant: FeishuUserToken) {
  return grantLease.withLease({ ...grantLeaseOptions(actor), fn: () => writeGrant(actor, grant) });
}

/** 获取在职成员的文档访问凭据。刷新凭据只能使用一次，用租约串行刷新。 */
export async function getFeishuDatasetAccessToken(actor: FeishuDatasetActor) {
  await assertFeishuOrgMember(actor);
  const key = grantKey(actor);
  const readGrant = async () => {
    const value = await redisCacheAdapter.get(key);
    if (!value) throw authorizationRequired();
    return StoredGrantSchema.parse(JSON.parse(decryptSecret(value)));
  };

  const grant = await readGrant();
  if (grant.expiresAt > Date.now() + 10_000) return grant.accessToken;
  if (!grant.refreshToken) throw authorizationRequired();

  try {
    return await grantLease.withLease({
      ...grantLeaseOptions(actor),
      async fn({ assertValid }) {
        const current = await readGrant();
        if (current.expiresAt > Date.now() + 10_000) return current.accessToken;
        if (!current.refreshToken) throw authorizationRequired();
        const refreshed = await requestFeishuUserToken({
          grant_type: 'refresh_token',
          refresh_token: current.refreshToken
        }).catch(() => {
          throw authorizationRequired();
        });
        assertValid();
        await writeGrant(actor, refreshed);
        return refreshed.access_token;
      }
    });
  } catch (error) {
    if (!(error instanceof RedisLeaseUnavailableError)) throw error;
    const current = await readGrant();
    if (current.expiresAt > Date.now()) return current.accessToken;
    throw new UserError(
      'Feishu dataset authorization is refreshing',
      '飞书授权更新中，请稍后重试。'
    );
  }
}
