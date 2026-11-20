import { DELETE, GET, POST, PUT } from '@/web/common/api/request';
import type {
  CreateOrgBodyType,
  FeishuAccessBody,
  FeishuAccessQuery,
  FeishuAccessResponse,
  ListOrgBodyType,
  MoveOrgBodyType,
  UpdateOrgBodyType,
  UpdateOrgMembersBodyType
} from '@fastgpt/global/openapi/support/user/team/org/api';
import type { OrgListItemType } from '@fastgpt/global/support/user/team/org/type';

const feishuAccessEndpoint = '/support/user/team/feishu/access';

/** 读取飞书组织授权候选项和指定知识库的协作者。 */
export const getFeishuAccess = (query?: FeishuAccessQuery) =>
  GET<FeishuAccessResponse>(feishuAccessEndpoint, query);

/** 保存或撤销飞书部门、员工在指定资源上的授权。 */
export const updateFeishuAccess = (body: FeishuAccessBody) => POST(feishuAccessEndpoint, body);

export const getOrgList = (params: ListOrgBodyType) =>
  POST<OrgListItemType[]>(`/proApi/support/user/team/org/list`, params);

export const postCreateOrg = (data: CreateOrgBodyType) =>
  POST('/proApi/support/user/team/org/create', data);

export const deleteOrg = (orgId: string) =>
  DELETE('/proApi/support/user/team/org/delete', { orgId });

export const putMoveOrg = (data: MoveOrgBodyType) =>
  PUT('/proApi/support/user/team/org/move', data);

export const putUpdateOrg = (data: UpdateOrgBodyType) =>
  PUT('/proApi/support/user/team/org/update', data);

// org members
export const putUpdateOrgMembers = (data: UpdateOrgMembersBodyType) =>
  PUT('/proApi/support/user/team/org/updateMembers', data);

export const deleteOrgMember = (orgId: string, tmbId: string) =>
  DELETE('/proApi/support/user/team/org/deleteMember', { orgId, tmbId });
