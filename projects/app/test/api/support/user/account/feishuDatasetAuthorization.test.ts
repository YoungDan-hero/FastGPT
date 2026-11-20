import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiRequestProps, ApiResponseType } from '@fastgpt/next/type';
import callback from '@/pages/api/support/user/account/login/feishu/callback';
import * as oauth from '@fastgpt/service/support/user/feishu/oauth';
import * as client from '@fastgpt/service/support/user/feishu/client';
import * as member from '@fastgpt/service/support/user/feishu/member';
import * as directory from '@fastgpt/service/support/user/feishu/directory';
import * as access from '@fastgpt/service/support/user/feishu/datasetAccess';
import * as guard from '@fastgpt/service/support/user/account/cancellation/guard';

describe('Feishu dataset authorization callback', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    { memberId: 'employee', status: 200 },
    { memberId: 'different-employee', status: 403 }
  ])('handles authorization for $memberId without a login cookie', async ({ memberId, status }) => {
    const state = 's'.repeat(43);
    const actor = { userId: 'user', teamId: 'team', tmbId: 'employee' };
    const credentials = { access_token: 'token', expires_in: 3600 };
    vi.spyOn(client, 'getFeishuOrgCredentials').mockReturnValue({ appId: 'app', secret: 'secret' });
    vi.spyOn(oauth, 'getFeishuOauthUrls').mockReturnValue({
      base: '',
      redirectUri: 'https://fastgpt.example.com/callback',
      stateCookie: () => `${oauth.feishuOauthCookie}=; Max-Age=0`
    });
    const consume = vi.spyOn(oauth, 'consumeFeishuOauth').mockResolvedValue({
      verifier: 'verifier',
      returnPath: '/dashboard/agent',
      datasetAccessMemberId: memberId
    });
    vi.spyOn(client, 'getFeishuLoginAccount').mockResolvedValue({
      openId: 'ou_employee',
      credentials
    });
    vi.spyOn(client, 'getFeishuTenantToken').mockResolvedValue('tenant-token');
    vi.spyOn(member, 'getFeishuLoginMember').mockResolvedValue(actor);
    vi.spyOn(directory, 'readFeishuEmployee').mockResolvedValue({
      open_id: 'ou_employee',
      name: 'Employee',
      department_ids: [],
      status: { is_activated: true }
    });
    vi.spyOn(guard, 'assertUserCanLogin').mockResolvedValue(undefined);
    const save = vi.spyOn(access, 'saveFeishuDatasetGrant').mockResolvedValue(undefined);

    const response = {
      setHeader: vi.fn().mockReturnThis(),
      status: vi.fn().mockReturnThis(),
      send: vi.fn()
    };
    await callback(
      {
        method: 'GET',
        query: { state, code: 'code' },
        cookies: { [oauth.feishuOauthCookie]: state }
      } as unknown as ApiRequestProps,
      response as unknown as ApiResponseType
    );

    expect(consume).toHaveBeenCalledWith('app', state, state);
    expect(response.status).toHaveBeenCalledWith(status);
    if (status === 200) expect(save).toHaveBeenCalledWith(actor, credentials);
    else expect(save).not.toHaveBeenCalled();
  });
});
