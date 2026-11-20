import type { ApiRequestProps, ApiResponseType } from '@fastgpt/next/type';
import { UserError } from '@fastgpt/global/common/error/utils';
import {
  FeishuHandoffGroupMutationSchema,
  FeishuHandoffGroupsResponseSchema
} from '@fastgpt/global/openapi/core/app/feishuHandoff/api';
import { parseApiInput } from '@fastgpt/service/common/zod/requestParseError';
import { MongoApp } from '@fastgpt/service/core/app/schema';
import { MongoFeishuHandoffGroup } from '@fastgpt/service/core/app/feishuHandoff/schema';
import {
  getFeishuHandoffMembers,
  updateFeishuHandoffSettings
} from '@fastgpt/service/core/app/feishuHandoff/service';
import { getFeishuHandoffBotCredentials } from '@fastgpt/service/core/app/feishuHandoff/bot';
import { authSystemAdmin } from '@fastgpt/service/support/permission/user/auth';
import { getFeishuOrgCredentials } from '@fastgpt/service/support/user/feishu/client';
import { getFeishuCompanyTeamId } from '@fastgpt/service/support/user/feishu/member';
import { NextAPI } from '@/service/middleware/entry';

export async function handler(req: ApiRequestProps, res: ApiResponseType) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();
  await authSystemAdmin({ req });
  getFeishuOrgCredentials();
  const teamId = await getFeishuCompanyTeamId();
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    const [groups, members] = await Promise.all([
      MongoFeishuHandoffGroup.find({ teamId }).sort({ name: 1 }).lean(),
      getFeishuHandoffMembers(teamId)
    ]);
    return FeishuHandoffGroupsResponseSchema.parse({
      botConfigured: Boolean(getFeishuHandoffBotCredentials()),
      groups: groups.map(({ _id, name, memberIds }) => ({ id: String(_id), name, memberIds })),
      members: members.map(({ id, name }) => ({ id, name }))
    });
  }

  const { body } = parseApiInput({ req, bodySchema: FeishuHandoffGroupMutationSchema });
  await updateFeishuHandoffSettings(teamId, async () => {
    if (body.action === 'delete') {
      if (
        await MongoApp.exists({
          teamId,
          deleteTime: null,
          'feishuHandoff.defaultGroupId': body.id
        })
      ) {
        throw new UserError('仍有应用绑定此客服组，请先修改应用的人工客服配置');
      }
      await MongoFeishuHandoffGroup.deleteOne({ _id: body.id, teamId });
      return;
    }

    const { id, name, memberIds } = body;
    const members = await getFeishuHandoffMembers(teamId, memberIds);
    if (members.length !== memberIds.length) throw new UserError('请选择已同步的在职飞书员工');
    if (await MongoFeishuHandoffGroup.exists({ teamId, name, ...(id && { _id: { $ne: id } }) })) {
      throw new UserError('客服组名称已存在');
    }
    if (!id) {
      await MongoFeishuHandoffGroup.create({ teamId, name, memberIds });
      return;
    }
    const result = await MongoFeishuHandoffGroup.updateOne(
      { _id: id, teamId },
      { name, memberIds }
    );
    if (!result.matchedCount) throw new UserError('客服组已删除');
  });
}

export default NextAPI(handler);
