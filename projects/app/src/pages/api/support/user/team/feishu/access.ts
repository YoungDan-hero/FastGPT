import type { FilterQuery, Model } from 'mongoose';
import type { ApiRequestProps, ApiResponseType } from '@fastgpt/next/type';
import { AppTypeEnum } from '@fastgpt/global/core/app/constants';
import { AuditEventEnum } from '@fastgpt/global/support/user/audit/constants';
import { CommonErrEnum } from '@fastgpt/global/common/error/code/common';
import {
  ManageRoleVal,
  OwnerRoleVal,
  PerResourceTypeEnum,
  ReadRoleVal,
  WriteRoleVal
} from '@fastgpt/global/support/permission/constant';
import {
  FeishuAccessBodySchema,
  FeishuAccessQuerySchema,
  FeishuAccessResponseSchema,
  type FeishuAccessCollaborator,
  type FeishuAccessQuery
} from '@fastgpt/global/openapi/support/user/team/org/api';
import type { OrgSchemaType } from '@fastgpt/global/support/user/team/org/type';
import { TeamMemberStatusEnum } from '@fastgpt/global/support/user/team/constant';
import { mongoSessionRun } from '@fastgpt/service/common/mongo/sessionRun';
import { parseApiInput } from '@fastgpt/service/common/zod/requestParseError';
import { MongoApp } from '@fastgpt/service/core/app/schema';
import { MongoDataset } from '@fastgpt/service/core/dataset/schema';
import { MongoDatasetCollection } from '@fastgpt/service/core/dataset/collection/schema';
import { getResourceOwnedClbs } from '@fastgpt/service/support/permission/controller';
import { resolveCollectionParentClbs } from '@fastgpt/service/support/permission/collection/controller';
import { assertDatasetCollectionPermissionEnabled } from '@fastgpt/service/support/permission/collection/datasetSwitch';
import {
  mergeResourceCollaborators,
  shouldInheritResourcePermission,
  toInheritedCollaborators
} from '@fastgpt/service/support/permission/resourcePermissionPolicy';
import { MongoOrgModel } from '@fastgpt/service/support/permission/org/orgSchema';
import { updateResourceCollaborators } from '@fastgpt/service/support/permission/resourcePermissionService';
import type { SyncChildrenPermissionResourceType } from '@fastgpt/service/support/permission/inheritPermission';
import { authSystemAdmin } from '@fastgpt/service/support/permission/user/auth';
import { addAuditLog } from '@fastgpt/service/support/user/audit/util';
import { getFeishuOrgCredentials } from '@fastgpt/service/support/user/feishu/client';
import {
  directoryVerifiedUser,
  getFeishuCompanyTeamId
} from '@fastgpt/service/support/user/feishu/member';
import { departmentPrefix } from '@fastgpt/service/support/user/feishu/sync';
import { MongoUser } from '@fastgpt/service/support/user/schema';
import { MongoTeamMember } from '@fastgpt/service/support/user/team/teamMemberSchema';
import { NextAPI } from '@/service/middleware/entry';

const roleValues = { read: ReadRoleVal, write: WriteRoleVal, manage: ManageRoleVal };

async function handler(req: ApiRequestProps<unknown, FeishuAccessQuery>, res: ApiResponseType) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();
  const admin = await authSystemAdmin({ req });
  const { appId } = getFeishuOrgCredentials();
  const teamId = await getFeishuCompanyTeamId();
  const departmentFilter: FilterQuery<OrgSchemaType> = {
    teamId,
    pathId: { $regex: `^${departmentPrefix(appId)}` },
    feishuOrgActive: true
  };
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    const { datasetId } = parseApiInput({ req, querySchema: FeishuAccessQuerySchema }).query;
    const dataset = datasetId
      ? await MongoDataset.findOne(
          { _id: datasetId, teamId, deleteTime: null },
          'name tmbId parentId inheritPermission'
        ).lean()
      : undefined;
    if (datasetId && !dataset) throw CommonErrEnum.invalidParams;

    const [departments, users, apps, datasets] = await Promise.all([
      MongoOrgModel.find(departmentFilter, 'name path pathId').sort({ name: 1 }).lean(),
      MongoUser.find(directoryVerifiedUser(teamId), '_id').lean(),
      dataset
        ? []
        : MongoApp.find({ teamId, deleteTime: null, type: { $ne: AppTypeEnum.hidden } }, 'name')
            .sort({ name: 1 })
            .lean(),
      dataset
        ? []
        : MongoDataset.find({ teamId, deleteTime: null }, 'name collectionPermissionEnabled')
            .sort({ name: 1 })
            .lean()
    ]);
    const collectionDatasets = new Map(
      datasets
        .filter((item) => item.collectionPermissionEnabled)
        .map((item) => [String(item._id), item.name])
    );
    const [members, collections] = await Promise.all([
      MongoTeamMember.find(
        {
          teamId,
          userId: { $in: users.map((item) => item._id) },
          status: TeamMemberStatusEnum.active
        },
        'name'
      )
        .sort({ name: 1 })
        .lean(),
      collectionDatasets.size
        ? MongoDatasetCollection.find(
            { teamId, datasetId: { $in: Array.from(collectionDatasets.keys()) } },
            'name datasetId'
          )
            .sort({ name: 1 })
            .lean()
        : []
    ]);
    const departmentNames = new Map(departments.map((dept) => [dept.pathId, dept.name]));
    const option = (item: { _id: unknown; name: string }) => ({
      id: String(item._id),
      name: item.name
    });
    const departmentOptions = departments.map((item) => ({
      ...option(item),
      name: [
        ...item.path.split('/').flatMap((id) => departmentNames.get(id) ?? []),
        item.name
      ].join(' / ')
    }));
    const memberOptions = members.map(option);

    if (dataset) {
      const resourceType = PerResourceTypeEnum.dataset;
      const ownerTmbId = String(dataset.tmbId);
      const [childCollaborators, parentCollaborators] = await Promise.all([
        getResourceOwnedClbs({ teamId, resourceType, resourceId: String(dataset._id) }),
        dataset.parentId && shouldInheritResourcePermission(dataset.inheritPermission)
          ? getResourceOwnedClbs({ teamId, resourceType, resourceId: String(dataset.parentId) })
          : []
      ]);
      const directory = {
        department: new Map(departmentOptions.map(({ id, name }) => [id, name])),
        member: new Map(memberOptions.map(({ id, name }) => [id, name]))
      };
      const inheritedIds = new Set(
        parentCollaborators.map((item) => String(item.orgId ?? item.tmbId))
      );
      const collaborators = mergeResourceCollaborators({
        parentCollaborators,
        childCollaborators: [...childCollaborators, { tmbId: ownerTmbId, permission: OwnerRoleVal }]
      }).flatMap<FeishuAccessCollaborator>((item) => {
        const principal = item.orgId ? 'department' : 'member';
        const id = String(item.orgId ?? item.tmbId);
        const name = directory[principal].get(id);
        if (name === undefined) return [];

        const role = (() => {
          if (item.permission === OwnerRoleVal) return 'owner';
          if (item.permission & ManageRoleVal) return 'manage';
          if (item.permission & WriteRoleVal) return 'write';
          if (item.permission & ReadRoleVal) return 'read';
        })();
        return role ? [{ id, name, principal, role, inherited: inheritedIds.has(id) }] : [];
      });

      return FeishuAccessResponseSchema.parse({
        departments: departmentOptions,
        members: memberOptions.filter(({ id }) => id !== ownerTmbId),
        app: [],
        dataset: [option(dataset)],
        collection: [],
        collaborators
      });
    }

    return FeishuAccessResponseSchema.parse({
      departments: departmentOptions,
      members: memberOptions,
      app: apps.map(option),
      dataset: datasets.map(option),
      collection: collections.map((item) => ({
        ...option(item),
        name: `${collectionDatasets.get(String(item.datasetId))} / ${item.name}`
      }))
    });
  }

  const {
    principal,
    principalId,
    resource: kind,
    resourceId,
    role
  } = parseApiInput({
    req,
    bodySchema: FeishuAccessBodySchema
  }).body;
  const resourceModel: Model<any> = {
    app: MongoApp,
    dataset: MongoDataset,
    collection: MongoDatasetCollection
  }[kind];
  const resourceType = PerResourceTypeEnum[kind];
  const target = principal === 'department' ? { orgId: principalId } : { tmbId: principalId };
  const objectName = await mongoSessionRun(async (session) => {
    if (principal === 'department') {
      if (
        !(await MongoOrgModel.exists({ ...departmentFilter, _id: principalId }).session(session))
      ) {
        throw CommonErrEnum.invalidParams;
      }
    } else {
      const member = await MongoTeamMember.findOne(
        {
          _id: principalId,
          teamId,
          status: TeamMemberStatusEnum.active
        },
        'userId'
      )
        .session(session)
        .lean();
      if (
        !member ||
        !(await MongoUser.exists({ _id: member.userId, ...directoryVerifiedUser(teamId) }).session(
          session
        ))
      ) {
        throw CommonErrEnum.invalidParams;
      }
    }

    const resource = await resourceModel
      .findOne(
        {
          _id: resourceId,
          teamId,
          deleteTime: null
        },
        '_id name type tmbId parentId datasetId inheritPermission'
      )
      .session(session)
      .lean<SyncChildrenPermissionResourceType & { name: string; tmbId: string }>();
    if (!resource) throw CommonErrEnum.invalidParams;
    const current = await getResourceOwnedClbs({ resourceType, teamId, resourceId, session });
    const isTarget = (item: { orgId?: string; tmbId?: string }) =>
      principalId === String(principal === 'department' ? item.orgId : item.tmbId);
    if (
      current.some((item) => isTarget(item) && item.permission === OwnerRoleVal) ||
      isTarget(resource)
    ) {
      throw CommonErrEnum.invalidParams;
    }
    const datasetId =
      'datasetId' in resource && resource.datasetId ? String(resource.datasetId) : undefined;
    if (datasetId) await assertDatasetCollectionPermissionEnabled({ datasetId, teamId, session });
    const parentCollaborators = datasetId
      ? await resolveCollectionParentClbs({
          teamId,
          datasetId,
          parentId: resource.parentId,
          session
        })
      : resource.parentId
        ? await getResourceOwnedClbs({
            resourceType,
            teamId,
            resourceId: String(resource.parentId),
            session
          })
        : undefined;

    // 知识库的旧记录可能还缺少物化的继承 ACL。修改单个对象前补齐其余继承项，避免误关闭继承。
    const datasetParentCollaborators =
      kind === 'dataset' &&
      parentCollaborators &&
      shouldInheritResourcePermission(resource.inheritPermission)
        ? toInheritedCollaborators(parentCollaborators)
        : undefined;
    const effectiveCollaborators = datasetParentCollaborators
      ? mergeResourceCollaborators({
          parentCollaborators: datasetParentCollaborators,
          childCollaborators: current
        })
      : current;

    await updateResourceCollaborators({
      resource: { ...resource, _id: resourceId, teamId, datasetId },
      resourceModel,
      resourceType,
      oldCollaborators: current,
      newCollaborators: [
        ...effectiveCollaborators.filter((item) => !isTarget(item)),
        ...(role === 'remove' ? [] : [{ ...target, permission: roleValues[role] }])
      ],
      parentCollaborators: datasetParentCollaborators ?? parentCollaborators,
      session
    });
    return resource.name;
  });

  await addAuditLog({
    teamId,
    tmbId: admin.tmbId,
    event: AuditEventEnum.ASSIGN_PERMISSION,
    params: { objectName, permission: role }
  });
  return null;
}

export default NextAPI(handler);
