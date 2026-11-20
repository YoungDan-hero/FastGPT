import { type TeamTmbItemType } from '@fastgpt/global/support/user/team/type';
import { getTmbInfoByTmbId } from '../../user/team/controller';
import { TeamErrEnum } from '@fastgpt/global/common/error/code/team';
import { type AuthModeType, type AuthResponseType } from '../type';
import { NullPermissionVal } from '@fastgpt/global/support/permission/constant';
import { TeamPermission } from '@fastgpt/global/support/permission/user/controller';
import { authCert, parseHeaderCert } from '../auth/common';
import { MongoUser } from '../../user/schema';
import { ERROR_ENUM } from '@fastgpt/global/common/error/errorCode';
import type { NodeHttpRequest } from '../../../types/http';
import { getProtectedFeishuAdminUsername } from '../../user/feishu/identity';

/* auth user role  */
export async function authUserPer(props: AuthModeType): Promise<
  AuthResponseType<TeamPermission> & {
    tmb: TeamTmbItemType;
  }
> {
  const result = await parseHeaderCert(props);
  const tmb = await getTmbInfoByTmbId({ tmbId: result.tmbId });

  if (result.isRoot) {
    return {
      ...result,
      permission: new TeamPermission({
        isOwner: true
      }),
      tmb
    };
  }
  if (!tmb.permission.checkPer(props.per ?? NullPermissionVal)) {
    return Promise.reject(TeamErrEnum.unAuthTeam);
  }

  return {
    ...result,
    permission: tmb.permission,
    tmb
  };
}

export const authSystemAdmin = async ({
  req,
  nativeRootOnly = false
}: {
  req: NodeHttpRequest;
  nativeRootOnly?: boolean;
}) => {
  const result = await authCert({ req, authToken: true });
  const user = await MongoUser.findById(result.userId, 'username').lean();
  if (
    !user ||
    (user.username !== 'root' &&
      (nativeRootOnly || !result.isRoot || user.username !== getProtectedFeishuAdminUsername()))
  ) {
    throw ERROR_ENUM.unAuthorization;
  }
  return result;
};
