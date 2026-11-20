import handler from '@/pages/api/support/user/team/feishu/access';
import { DatasetTypeEnum } from '@fastgpt/global/core/dataset/constants';
import type {
  FeishuAccessBody,
  FeishuAccessQuery,
  FeishuAccessResponse
} from '@fastgpt/global/openapi/support/user/team/org/api';
import {
  OwnerRoleVal,
  PerResourceTypeEnum,
  ReadPermissionVal
} from '@fastgpt/global/support/permission/constant';
import { UserStatusEnum } from '@fastgpt/global/support/user/constant';
import { MongoDataset } from '@fastgpt/service/core/dataset/schema';
import { authDatasetByTmbId } from '@fastgpt/service/support/permission/dataset/auth';
import { MongoOrgMemberModel } from '@fastgpt/service/support/permission/org/orgMemberSchema';
import { MongoOrgModel } from '@fastgpt/service/support/permission/org/orgSchema';
import { MongoResourcePermission } from '@fastgpt/service/support/permission/schema';
import * as feishuClient from '@fastgpt/service/support/user/feishu/client';
import * as feishuMember from '@fastgpt/service/support/user/feishu/member';
import { departmentPrefix } from '@fastgpt/service/support/user/feishu/sync';
import { MongoUser } from '@fastgpt/service/support/user/schema';
import { getRootUser, getUser } from '@test/datas/users';
import { Call } from '@test/utils/request';
import { afterEach, describe, expect, it, vi } from 'vitest';

const appId = 'test-feishu-org';

/** 桩只代替飞书应用配置，授权查询和变更都经过隔离的 MongoDB。 */
const createCompany = async () => {
  const admin = await getRootUser();
  vi.spyOn(feishuClient, 'getFeishuOrgCredentials').mockReturnValue({ appId, secret: 'test' });
  vi.spyOn(feishuMember, 'getFeishuCompanyTeamId').mockResolvedValue(admin.teamId);
  vi.spyOn(feishuMember, 'directoryVerifiedUser').mockImplementation((teamId) => ({
    status: UserStatusEnum.active,
    'feishuOrg.appId': appId,
    'feishuOrg.teamId': teamId,
    'feishuOrg.checkedAt': { $gte: new Date(Date.now() - 5 * 60_000) }
  }));
  return admin;
};

describe('knowledge base Feishu collaborators', () => {
  afterEach(() => vi.restoreAllMocks());

  it('loads only the requested dataset and applies department and employee grants', async () => {
    const admin = await createCompany();
    const { teamId } = admin;
    const folderOwner = await getUser('test-folder-owner', teamId);
    const employee = await getUser('test-feishu-employee', teamId);
    await MongoUser.updateMany(
      { _id: { $in: [folderOwner.userId, employee.userId] } },
      { feishuOrg: { appId, teamId, checkedAt: new Date() } }
    );
    const department = await MongoOrgModel.create({
      teamId,
      name: '研发部',
      pathId: `${departmentPrefix(appId)}rd`,
      path: 'root',
      feishuOrgActive: true
    });
    const subdivision = await MongoOrgModel.create({
      teamId,
      name: '平台组',
      pathId: `${departmentPrefix(appId)}platform`,
      path: `${department.path}/${department.pathId}`,
      feishuOrgActive: true
    });
    await MongoOrgMemberModel.create({ teamId, tmbId: employee.tmbId, orgId: subdivision._id });
    const folder = await MongoDataset.create({
      name: 'Test parent folder',
      type: DatasetTypeEnum.folder,
      teamId,
      tmbId: folderOwner.tmbId
    });
    await MongoResourcePermission.create({
      resourceType: PerResourceTypeEnum.dataset,
      resourceId: folder._id,
      teamId,
      tmbId: folderOwner.tmbId,
      permission: OwnerRoleVal
    });
    const dataset = await MongoDataset.create({
      name: 'Test company dataset',
      type: DatasetTypeEnum.dataset,
      teamId,
      tmbId: admin.tmbId,
      parentId: folder._id,
      inheritPermission: true
    });
    const datasetId = String(dataset._id);
    const principalId = String(department._id);
    const get = () =>
      Call<never, FeishuAccessQuery, FeishuAccessResponse>(handler, {
        method: 'GET',
        auth: admin,
        query: { datasetId }
      });
    const setRole = (
      role: FeishuAccessBody['role'],
      principal: FeishuAccessBody['principal'] = 'department'
    ) =>
      Call<FeishuAccessBody>(handler, {
        method: 'POST',
        auth: admin,
        body: {
          resource: 'dataset',
          resourceId: datasetId,
          principal,
          principalId: principal === 'member' ? employee.tmbId : principalId,
          role
        }
      });
    const accessAsEmployee = () =>
      authDatasetByTmbId({
        datasetId,
        tmbId: employee.tmbId,
        per: ReadPermissionVal
      });

    expect((await get()).data).toMatchObject({
      dataset: [{ id: datasetId, name: dataset.name }],
      app: [],
      collection: [],
      collaborators: [
        { id: folderOwner.tmbId, principal: 'member', role: 'manage', inherited: true }
      ]
    });
    expect((await setRole('read')).code).toBe(200);
    expect((await accessAsEmployee()).dataset.permission.hasReadPer).toBe(true);
    expect((await setRole('write')).code).toBe(200);
    expect((await get()).data.collaborators).toContainEqual({
      id: principalId,
      name: department.name,
      principal: 'department',
      role: 'write',
      inherited: false
    });
    expect((await setRole('remove')).code).toBe(200);
    await expect(accessAsEmployee()).rejects.toBeTruthy();
    expect((await get()).data.collaborators?.map(({ id }) => id)).toEqual([folderOwner.tmbId]);
    expect((await setRole('read', 'member')).code).toBe(200);
    expect((await get()).data.collaborators).toContainEqual(
      expect.objectContaining({
        id: employee.tmbId,
        principal: 'member',
        role: 'read',
        inherited: false
      })
    );
    expect((await MongoDataset.findById(datasetId).lean())?.inheritPermission).toBe(true);
  });

  it('rejects an unauthorized caller and a dataset from another team', async () => {
    const admin = await createCompany();
    const external = await getUser('test-other-company');
    const dataset = await MongoDataset.create({
      name: 'Other company dataset',
      type: DatasetTypeEnum.dataset,
      teamId: external.teamId,
      tmbId: external.tmbId
    });
    const query = { datasetId: String(dataset._id) };

    expect((await Call(handler, { method: 'GET', auth: admin, query })).code).not.toBe(200);
    expect((await Call(handler, { method: 'GET', auth: external })).code).not.toBe(200);
  });
});
