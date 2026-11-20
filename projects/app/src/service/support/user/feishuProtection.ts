import type { NextApiRequest } from 'next';
import { z } from 'zod';
import { authCert } from '@fastgpt/service/support/permission/auth/common';
import { authSystemAdmin } from '@fastgpt/service/support/permission/user/auth';
import { getProtectedFeishuAdminUsername } from '@fastgpt/service/support/user/feishu/identity';
import { MongoUser } from '@fastgpt/service/support/user/schema';
import { MongoTeamMember } from '@fastgpt/service/support/user/team/teamMemberSchema';

/** Before forwarding a Pro account mutation, resolve its target within the authenticated application. */
export async function isProtectedFeishuProMutation(
  req: NextApiRequest,
  target: URL,
  request: Request
) {
  const username = getProtectedFeishuAdminUsername();
  if (!username) return false;

  const path = decodeURIComponent(target.pathname).replace(/\/+$/, '');
  if (
    req.method === 'POST' &&
    (path === '/api/admin/user/delete' || path === '/api/admin/user/updateUser')
  ) {
    await authSystemAdmin({ req });
    const body = z
      .object({ username: z.string().optional(), _id: z.string().optional() })
      .parse(await request.clone().json());
    if (body.username === username) return true;
    return !!body._id && Boolean(await MongoUser.exists({ _id: body._id, username }));
  }

  if (req.method === 'DELETE' && path === '/api/support/user/team/member/delete') {
    const tmbId = target.searchParams.get('tmbId');
    const user = tmbId && (await MongoUser.findOne({ username }, '_id').lean());
    return Boolean(user && (await MongoTeamMember.exists({ _id: tmbId, userId: user._id })));
  }

  if (
    (req.method === 'DELETE' && path === '/api/support/user/team/member/leave') ||
    (req.method === 'POST' && path === '/api/support/user/account/cancellation/submit')
  ) {
    const { userId } = await authCert({ req, authToken: true, allowAccountCancellation: true });
    return Boolean(await MongoUser.exists({ _id: userId, username }));
  }

  return false;
}
