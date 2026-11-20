import { createHash } from 'node:crypto';
import { LeaseCache, RedisLeaseUnavailableError } from '@fastgpt/dal/redis/caches/lease';
import { UserStatusEnum } from '@fastgpt/global/support/user/constant';
import { TeamMemberStatusEnum } from '@fastgpt/global/support/user/team/constant';
import { getOrgChildrenPath } from '@fastgpt/global/support/user/team/org/constant';
import { DEFAULT_ORG_AVATAR } from '@fastgpt/global/common/system/constants';
import { mongoSessionRun } from '../../../common/mongo/sessionRun';
import { getLogger, LogCategories } from '../../../common/logger';
import { serviceEnv } from '../../../env';
import { MongoOrgModel } from '../../permission/org/orgSchema';
import { MongoOrgMemberModel } from '../../permission/org/orgMemberSchema';
import { createRootOrg } from '../../permission/org/controllers';
import { MongoUser } from '../schema';
import { MongoTeamMember } from '../team/teamMemberSchema';
import { delUserAllSession } from '../session';
import { getFeishuOrgCredentials } from './client';
import {
  getFeishuAvatar,
  getFeishuDepartmentFallbackName,
  isActiveFeishuEmployee,
  readFeishuDirectory
} from './directory';
import { feishuUsername } from './identity';
import { getFeishuCompanyTeamId } from './member';

const logger = getLogger(LogCategories.MODULE.USER.ACCOUNT);
const lease = new LeaseCache();
export const departmentPrefix = (appId: string) =>
  `feishu-${createHash('sha256').update(appId).digest('hex').slice(0, 16)}-`;

export async function syncFeishuOrganization() {
  const { appId } = getFeishuOrgCredentials();
  return lease.withLease({
    key: 'feishu-organization',
    label: 'Feishu directory',
    ttlMs: 30_000,
    fn: async ({ assertValid }) => {
      const teamId = await getFeishuCompanyTeamId();
      const checkedAt = new Date();
      const { departments, employees } = await readFeishuDirectory(assertValid);
      const activeEmployees = [...employees.values()].filter(isActiveFeishuEmployee);
      const prefix = departmentPrefix(appId);
      const provider = { 'feishuOrg.appId': appId, 'feishuOrg.teamId': teamId };
      const revoked = await mongoSessionRun(async (session) => {
        assertValid();
        const rootOrg =
          (await MongoOrgModel.findOne({ teamId, path: '' }).session(session).lean()) ??
          (await createRootOrg({ teamId, session }))[0];
        const rootPath = getOrgChildrenPath(rootOrg);
        const orgIds = new Map<string, string>();
        for (const [id, department] of departments) {
          const parents = new Set([id]);
          const path = [rootPath];
          let parentId = department.parent_department_id;
          while (departments.has(parentId)) {
            if (parents.has(parentId))
              throw new Error('Feishu department hierarchy contains a cycle');
            parents.add(parentId);
            path.splice(1, 0, `${prefix}${parentId}`);
            parentId = departments.get(parentId)!.parent_department_id;
          }
          const org = await MongoOrgModel.findOneAndUpdate(
            { teamId, pathId: `${prefix}${id}` },
            {
              $set: {
                path: path.join('/'),
                avatar: DEFAULT_ORG_AVATAR,
                feishuOrgActive: true,
                ...(department.name && { name: department.name })
              },
              ...(!department.name && {
                $setOnInsert: { name: getFeishuDepartmentFallbackName(id) }
              })
            },
            { upsert: true, new: true, session }
          ).lean();
          orgIds.set(id, String(org._id));
        }
        const mirroredOrgs = await MongoOrgModel.find(
          {
            teamId,
            pathId: { $regex: `^${prefix}` }
          },
          '_id'
        )
          .session(session)
          .lean();
        const mirroredOrgIds = mirroredOrgs.map(({ _id }) => String(_id));
        const activeOrgIds = new Set(orgIds.values());
        await MongoOrgModel.updateMany(
          {
            _id: { $in: mirroredOrgIds.filter((id) => !activeOrgIds.has(id)) },
            feishuOrgActive: true
          },
          { $set: { feishuOrgActive: false } },
          { session }
        );

        for (const employee of activeEmployees) {
          assertValid();
          const user = await MongoUser.findOneAndUpdate(
            { username: feishuUsername(appId, employee.open_id), ...provider },
            {
              $set: {
                'feishuOrg.checkedAt': checkedAt,
                'feishuOrg.nickname': employee.nickname || null,
                'feishuOrg.unionId': employee.union_id ?? null
              },
              $setOnInsert: { status: UserStatusEnum.active }
            },
            { upsert: true, new: true, session }
          ).lean();
          const avatar = getFeishuAvatar(employee);
          const member = await MongoTeamMember.findOneAndUpdate(
            { teamId, userId: user._id },
            {
              $set: { name: employee.name, isSetMemberName: true, ...(avatar && { avatar }) },
              $setOnInsert: { status: TeamMemberStatusEnum.active }
            },
            { upsert: true, new: true, session }
          ).lean();
          if (member.status === TeamMemberStatusEnum.leave) {
            await MongoTeamMember.updateOne(
              { _id: member._id, status: TeamMemberStatusEnum.leave },
              { $set: { status: TeamMemberStatusEnum.active } },
              { session }
            );
          }

          const currentOrgIds = employee.department_ids.flatMap((id) => {
            const orgId = orgIds.get(id);
            return orgId ? [orgId] : [];
          });
          await MongoOrgMemberModel.deleteMany(
            {
              teamId,
              tmbId: member._id,
              orgId: { $in: mirroredOrgIds.filter((id) => !currentOrgIds.includes(id)) }
            },
            { session }
          );
          if (currentOrgIds.length) {
            await MongoOrgMemberModel.bulkWrite(
              [...new Set(currentOrgIds)].map((orgId) => ({
                updateOne: {
                  filter: { teamId, tmbId: member._id, orgId },
                  update: { $setOnInsert: { teamId, tmbId: member._id, orgId } },
                  upsert: true
                }
              })),
              { session }
            );
          }
        }

        const missing = await MongoUser.find(
          {
            ...provider,
            'feishuOrg.checkedAt': { $nin: [checkedAt, null] }
          },
          '_id'
        )
          .session(session)
          .lean();
        const userIds = missing.map(({ _id }) => String(_id));
        if (userIds.length) {
          const members = await MongoTeamMember.find(
            {
              userId: { $in: userIds },
              teamId
            },
            '_id'
          )
            .session(session)
            .lean();
          await MongoUser.updateMany(
            { _id: { $in: userIds } },
            { $set: { 'feishuOrg.checkedAt': null, 'feishuOrg.revokedAt': new Date() } },
            { session }
          );
          await MongoTeamMember.updateMany(
            { _id: { $in: members.map(({ _id }) => _id) }, status: TeamMemberStatusEnum.active },
            { $set: { status: TeamMemberStatusEnum.leave } },
            { session }
          );
          await MongoOrgMemberModel.deleteMany(
            {
              teamId,
              tmbId: { $in: members.map(({ _id }) => _id) },
              orgId: { $in: mirroredOrgIds }
            },
            { session }
          );
        }
        assertValid();
        return userIds;
      });
      await Promise.allSettled(revoked.map((userId) => delUserAllSession(userId)));
      logger.info('Feishu directory synchronized', {
        teamId,
        departments: departments.size,
        namedDepartments: [...departments.values()].filter((dept) => dept.name).length,
        activeMembers: activeEmployees.length,
        revoked: revoked.length
      });
    }
  });
}

export async function refreshFeishuOrganization() {
  if (!serviceEnv.FEISHU_ORG_ENABLED) return;
  try {
    await syncFeishuOrganization();
  } catch (error) {
    if (error instanceof RedisLeaseUnavailableError) return;
    logger.warn('Feishu directory synchronization failed', { error });
  }
}
