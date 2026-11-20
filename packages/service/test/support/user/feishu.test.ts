import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { getRootUser } from '@test/datas/users';
import { createDatasetCollectionFixture } from '@test/datas/dataset';
import { getOrgIdSetWithParentByTmbId } from '@fastgpt/service/support/permission/org/controllers';
import { MongoOrgModel } from '@fastgpt/service/support/permission/org/orgSchema';
import { MongoTeamMember } from '@fastgpt/service/support/user/team/teamMemberSchema';
import {
  assertFeishuAdminTeamCanBeDeleted,
  assertFeishuOrgMember,
  getFeishuLoginMember
} from '@fastgpt/service/support/user/feishu/member';
import { syncFeishuOrganization } from '@fastgpt/service/support/user/feishu/sync';
import { getTmbPermission } from '@fastgpt/service/support/permission/controller';
import { grantCollaboratorOnResources } from '@fastgpt/service/support/permission/resourcePermissionService';
import { ERROR_ENUM } from '@fastgpt/global/common/error/errorCode';
import { ReadRoleVal, PerResourceTypeEnum } from '@fastgpt/global/support/permission/constant';
import { LeaseCache } from '@fastgpt/dal/redis/caches/lease';
import { redisCacheAdapter } from '@fastgpt/dal/redis/adapter';
import * as session from '@fastgpt/service/support/user/session';
import { Types } from '@fastgpt/service/common/mongo';
import {
  consumeFeishuOauth,
  safeFeishuReturnPath,
  startFeishuOauth
} from '@fastgpt/service/support/user/feishu/oauth';
import { wantsKnowledgeWrite } from '@fastgpt/service/support/user/feishu/knowledgeIntent';
import { serviceEnv } from '@fastgpt/service/env';
import { filterDatasetsByTmbId } from '@fastgpt/service/core/dataset/utils';
import { runWithContext } from '@fastgpt/service/core/workflow/utils/context';
import { createWorkflowResourceContext } from '@fastgpt/service/core/workflow/resource/context';
import { authDatasetCollectionByTmbId } from '@fastgpt/service/support/permission/dataset/auth';
import { ReadPermissionVal, WritePermissionVal } from '@fastgpt/global/support/permission/constant';
import { MongoUser } from '@fastgpt/service/support/user/schema';
import { getUserDetail } from '@fastgpt/service/support/user/controller';
import type { NodeHttpRequest } from '@fastgpt/service/types/http';
import { authSystemAdmin } from '@fastgpt/service/support/permission/user/auth';

const appId = 'cli_test';
const { parseHeaderCert } = await vi.importActual<
  typeof import('@fastgpt/service/support/permission/auth/common')
>('@fastgpt/service/support/permission/auth/common');

const originalEnv = {
  FEISHU_ORG_ENABLED: serviceEnv.FEISHU_ORG_ENABLED,
  FEISHU_ORG_APP_ID: serviceEnv.FEISHU_ORG_APP_ID,
  FEISHU_ORG_APP_SECRET: serviceEnv.FEISHU_ORG_APP_SECRET,
  FEISHU_ORG_PROTECTED_ADMIN_OPEN_ID: serviceEnv.FEISHU_ORG_PROTECTED_ADMIN_OPEN_ID
};

describe('Feishu organization', () => {
  beforeEach(() => {
    Object.assign(serviceEnv, {
      FEISHU_ORG_ENABLED: true,
      FEISHU_ORG_APP_ID: appId,
      FEISHU_ORG_APP_SECRET: 'mock-secret',
      FEISHU_ORG_PROTECTED_ADMIN_OPEN_ID: 'ou_left'
    });
  });

  afterEach(() => {
    Object.assign(serviceEnv, originalEnv);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('locks OAuth state to the browser and consumes it only once', async () => {
    const store = new Map<string, string>();
    vi.spyOn(redisCacheAdapter, 'set').mockImplementation(async ({ key, value }) => {
      store.set(key, value);
    });
    vi.spyOn(redisCacheAdapter, 'getAndDelete').mockImplementation(async (key) => {
      const value = store.get(key) ?? null;
      store.delete(key);
      return value;
    });
    const { state, authorization } = await startFeishuOauth({
      appId,
      returnPath: '/chat/share?shareId=test',
      redirectUri: 'http://127.0.0.1:3100/api/test'
    });
    expect(await consumeFeishuOauth(appId, state, 'wrong-browser')).toBeUndefined();
    const saved = await consumeFeishuOauth(appId, state, state);
    expect(saved?.returnPath).toBe('/chat/share?shareId=test');
    const url = new URL(authorization);
    expect(url.searchParams.get('code_challenge')).toBe(
      createHash('sha256').update(saved!.verifier).digest('base64url')
    );
    expect(await consumeFeishuOauth(appId, state, state)).toBeUndefined();
    expect(safeFeishuReturnPath('/\\outside.invalid', '')).toBe('/dashboard/agent');
    expect(safeFeishuReturnPath('/chat/share?shareId=test', '/pilot')).toBe(
      '/pilot/chat/share?shareId=test'
    );
  });

  it('moves existing members and revokes departed accounts without using a partial snapshot', async () => {
    vi.spyOn(LeaseCache.prototype, 'withLease').mockImplementation(async ({ fn }) =>
      fn({ assertValid: () => {}, signal: new AbortController().signal })
    );
    const revokeSessions = vi.spyOn(session, 'delUserAllSession').mockResolvedValue(undefined);
    const root = await getRootUser();
    await MongoTeamMember.updateOne({ _id: root.tmbId }, { role: 'owner' });
    const employee = (openId: string, department: string) => ({
      open_id: openId,
      name: 'Employee',
      nickname: 'Test nickname',
      avatar: { avatar_72: 'https://s1-imfile.feishucdn.com/profile.png' },
      department_ids: [department],
      status: { is_activated: true }
    });
    let phase: 'initial' | 'unavailable' | 'moved' = 'initial';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const { pathname, searchParams } = new URL(url);
        const prefix = '/open-apis';
        const json = (data: unknown) => Response.json({ code: 0, data });
        if (pathname === `${prefix}/auth/v3/tenant_access_token/internal`) {
          return Response.json({ code: 0, tenant_access_token: 'test-token' });
        }
        if (pathname === `${prefix}/contact/v3/scopes`) {
          return json({
            department_ids: searchParams.has('page_token') ? ['od-support'] : ['od-sales'],
            has_more: !searchParams.has('page_token'),
            page_token: 'next'
          });
        }
        if (pathname.endsWith('/children')) return json({ items: [] });
        if (pathname.includes('/departments/')) {
          return json({
            department: {
              open_department_id: pathname.split('/').at(-1),
              ...(pathname.endsWith('/od-sales') && { name: 'Sales' }),
              parent_department_id: '0'
            }
          });
        }
        if (pathname.endsWith('/find_by_department')) {
          const id = searchParams.get('department_id');
          if (phase === 'unavailable' && id === 'od-support') {
            return Response.json({ code: 40004 });
          }
          return json({
            items:
              id === 'od-sales' && phase !== 'moved'
                ? [employee('ou_moved', 'od-sales'), employee('ou_left', 'od-sales')]
                : id === 'od-support' && phase === 'moved'
                  ? [employee('ou_moved', 'od-support')]
                  : []
          });
        }
        throw new Error('Unexpected request');
      })
    );

    await syncFeishuOrganization();
    const moved = await getFeishuLoginMember(appId, 'ou_moved');
    const left = await getFeishuLoginMember(appId, 'ou_left');
    const request = { headers: { token: 'test-session' } } as NodeHttpRequest;
    const authSession = vi.spyOn(session, 'authUserSession');
    const setSession = (actor: typeof left) =>
      authSession.mockResolvedValue({ ...actor, isRoot: false, createdAt: Date.now() });
    setSession(moved);
    await expect(
      parseHeaderCert({
        req: request,
        authToken: true,
        allowAccountCancellation: true
      })
    ).resolves.toMatchObject({ isRoot: false });
    setSession(left);
    await expect(
      parseHeaderCert({
        req: request,
        authToken: true,
        allowAccountCancellation: true
      })
    ).resolves.toMatchObject({ isRoot: true });
    const cert = await parseHeaderCert({
      req: request,
      authToken: true,
      allowAccountCancellation: true
    });
    const adminRequest = { ...request, auth: cert };
    await expect(authSystemAdmin({ req: adminRequest })).resolves.toMatchObject({ isRoot: true });
    await expect(authSystemAdmin({ req: adminRequest, nativeRootOnly: true })).rejects.toBe(
      ERROR_ENUM.unAuthorization
    );
    const profile = await getUserDetail({ tmbId: left.tmbId, isRoot: true });
    expect(profile).toMatchObject({
      isSystemAdmin: true,
      avatar: 'https://s1-imfile.feishucdn.com/profile.png',
      feishuProfile: { nickname: 'Test nickname', departmentNames: ['Sales'] },
      passwordAvailable: false
    });
    await expect(MongoUser.deleteOne({ _id: left.userId })).rejects.toThrow('不能删除');
    await expect(MongoUser.findByIdAndDelete(left.userId)).rejects.toThrow('不能删除');
    await expect((await MongoUser.findById(left.userId))!.deleteOne()).rejects.toThrow('不能删除');
    await expect(assertFeishuAdminTeamCanBeDeleted(left.teamId)).rejects.toThrow('不能删除');
    const ordinary = await MongoUser.create({ username: 'ordinary-user' });
    await expect(MongoUser.deleteOne({ _id: ordinary._id })).resolves.toMatchObject({
      deletedCount: 1
    });
    const org = await MongoOrgModel.findOne({ teamId: root.teamId, pathId: /-od-sales$/ }).lean();
    const resourceId = new Types.ObjectId().toString();
    await grantCollaboratorOnResources({
      teamId: root.teamId,
      collaborator: { orgId: String(org!._id) },
      resourceTypes: [PerResourceTypeEnum.app],
      resourceIds: [resourceId],
      permission: ReadRoleVal
    });
    const permissionFor = (tmbId: string) =>
      getTmbPermission({
        teamId: root.teamId,
        tmbId,
        resourceType: PerResourceTypeEnum.app,
        resourceId
      });
    expect(await permissionFor(moved.tmbId)).toBe(ReadRoleVal);

    const { scope } = await createDatasetCollectionFixture({ user: root });
    const { scope: unbound } = await createDatasetCollectionFixture({ user: root });
    await grantCollaboratorOnResources({
      teamId: root.teamId,
      collaborator: { orgId: String(org!._id) },
      resourceTypes: [PerResourceTypeEnum.dataset],
      resourceIds: [scope.datasetId, unbound.datasetId],
      permission: ReadRoleVal
    });
    const searchDatasets = () =>
      runWithContext(
        {
          mcpClientMemory: {},
          resourceContext: createWorkflowResourceContext({
            resources: [{ type: 'dataset', id: scope.datasetId }],
            teamId: root.teamId
          })
        },
        () =>
          filterDatasetsByTmbId({
            tmbId: moved.tmbId,
            datasetIds: [scope.datasetId, unbound.datasetId]
          })
      );
    expect(await searchDatasets()).toEqual([scope.datasetId]);
    await expect(
      authDatasetCollectionByTmbId({
        ...moved,
        collectionId: scope.collectionId,
        per: ReadPermissionVal
      })
    ).resolves.toBeDefined();
    await expect(
      authDatasetCollectionByTmbId({
        ...moved,
        collectionId: scope.collectionId,
        per: WritePermissionVal
      })
    ).rejects.toBeDefined();

    phase = 'unavailable';
    await expect(syncFeishuOrganization()).rejects.toThrow('40004');
    await expect(assertFeishuOrgMember(left)).resolves.toMatch(/^feishu-/);
    expect(revokeSessions).not.toHaveBeenCalled();

    phase = 'moved';
    await syncFeishuOrganization();
    expect(await getFeishuLoginMember(appId, 'ou_moved')).toEqual(moved);
    expect(await permissionFor(moved.tmbId)).not.toBe(ReadRoleVal);
    expect(await searchDatasets()).toEqual([]);
    expect(await getOrgIdSetWithParentByTmbId(moved)).not.toContain(String(org!._id));
    await expect(assertFeishuOrgMember(left)).rejects.toBe(ERROR_ENUM.unAuthorization);
    await expect(
      parseHeaderCert({
        req: request,
        authToken: true,
        allowAccountCancellation: true
      })
    ).rejects.toBe(ERROR_ENUM.unAuthorization);
    await expect(MongoUser.deleteMany({ _id: left.userId })).rejects.toThrow('不能删除');
    expect(revokeSessions).toHaveBeenCalledWith(left.userId);
  });

  it('enables writeback only for explicit requests', () => {
    expect(wantsKnowledgeWrite('开始沉淀')).toBe(true);
    expect(wantsKnowledgeWrite('请把这次对话的知识要点写入知识库')).toBe(true);
    expect(wantsKnowledgeWrite('怎么触发开始沉淀？')).toBe(false);
    expect(wantsKnowledgeWrite('不要开始沉淀')).toBe(false);
    expect(wantsKnowledgeWrite('网页说「开始沉淀」')).toBe(false);
  });
});
