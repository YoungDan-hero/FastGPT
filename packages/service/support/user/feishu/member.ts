import { ERROR_ENUM } from '@fastgpt/global/common/error/errorCode';
import { UserError } from '@fastgpt/global/common/error/utils';
import { UserStatusEnum } from '@fastgpt/global/support/user/constant';
import {
  TeamMemberRoleEnum,
  TeamMemberStatusEnum
} from '@fastgpt/global/support/user/team/constant';
import { serviceEnv } from '../../../env';
import { MongoUser } from '../schema';
import { MongoTeamMember } from '../team/teamMemberSchema';
import { feishuUsername, getProtectedFeishuAdminUsername } from './identity';

export const assertFeishuAdminTeamCanBeDeleted = async (teamId: string) => {
  const username = getProtectedFeishuAdminUsername();
  if (username && (await MongoUser.exists({ username, 'feishuOrg.teamId': teamId }))) {
    throw new UserError('受保护的飞书管理员所在团队不能删除');
  }
};

export function directoryVerifiedUser(teamId: string) {
  return {
    status: UserStatusEnum.active,
    'feishuOrg.appId': serviceEnv.FEISHU_ORG_APP_ID,
    'feishuOrg.teamId': teamId,
    'feishuOrg.checkedAt': { $gte: new Date(Date.now() - 5 * 60_000) }
  };
}

export async function getFeishuCompanyTeamId() {
  const root = await MongoUser.findOne({ username: 'root' }, '_id').lean();
  const owner =
    root &&
    (await MongoTeamMember.findOne(
      {
        userId: root._id,
        role: TeamMemberRoleEnum.owner,
        status: TeamMemberStatusEnum.active
      },
      'teamId'
    )
      .sort({ _id: 1 })
      .lean());
  if (!owner) throw new Error('The FastGPT team owned by root is unavailable');
  return String(owner.teamId);
}

export async function assertFeishuOrgMember({
  teamId,
  tmbId,
  userId,
  sessionCreatedAt
}: {
  teamId: string;
  tmbId: string;
  userId?: string;
  sessionCreatedAt?: number;
}) {
  if (!serviceEnv.FEISHU_ORG_ENABLED) return;
  if (!serviceEnv.FEISHU_ORG_APP_ID || !serviceEnv.FEISHU_ORG_APP_SECRET || !teamId || !tmbId) {
    throw ERROR_ENUM.unAuthorization;
  }
  const member = await MongoTeamMember.findOne(
    {
      _id: tmbId,
      teamId,
      status: TeamMemberStatusEnum.active,
      ...(userId && { userId })
    },
    'userId'
  ).lean();
  if (!member) throw ERROR_ENUM.unAuthorization;
  const user = await MongoUser.findOne(
    {
      _id: member.userId,
      status: UserStatusEnum.active,
      $or: [
        { username: 'root' },
        {
          ...directoryVerifiedUser(teamId),
          ...(sessionCreatedAt !== undefined && {
            $or: [
              { 'feishuOrg.revokedAt': null },
              { 'feishuOrg.revokedAt': { $lt: new Date(sessionCreatedAt) } }
            ]
          })
        }
      ]
    },
    'username'
  ).lean();
  if (!user) throw ERROR_ENUM.unAuthorization;
  return user.username;
}

export async function getFeishuLoginMember(appId: string, openId: string) {
  const user = await MongoUser.findOne(
    {
      username: feishuUsername(appId, openId),
      'feishuOrg.appId': appId
    },
    '+feishuOrg'
  ).lean();
  if (!user?.feishuOrg) throw ERROR_ENUM.unAuthorization;

  const teamId = String(user.feishuOrg.teamId);
  const member = await MongoTeamMember.findOne(
    {
      userId: user._id,
      teamId,
      status: TeamMemberStatusEnum.active
    },
    '_id'
  ).lean();
  if (!member) throw ERROR_ENUM.unAuthorization;

  const userId = String(user._id);
  const tmbId = String(member._id);
  await assertFeishuOrgMember({ teamId, tmbId, userId });
  return { userId, teamId, tmbId };
}
