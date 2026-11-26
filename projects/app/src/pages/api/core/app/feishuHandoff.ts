import type { ApiRequestProps, ApiResponseType } from '@fastgpt/next/type';
import { UserError } from '@fastgpt/global/common/error/utils';
import { WritePermissionVal } from '@fastgpt/global/support/permission/constant';
import { feishuHandoffAppTypes } from '@fastgpt/global/core/app/feishuHandoff';
import {
  FeishuHandoffConfigBodySchema,
  FeishuHandoffConfigQuerySchema,
  FeishuHandoffConfigResponseSchema
} from '@fastgpt/global/openapi/core/app/feishuHandoff/api';
import { parseApiInput } from '@fastgpt/service/common/zod/requestParseError';
import { MongoApp } from '@fastgpt/service/core/app/schema';
import { MongoFeishuHandoffGroup } from '@fastgpt/service/core/app/feishuHandoff/schema';
import { updateFeishuHandoffSettings } from '@fastgpt/service/core/app/feishuHandoff/service';
import { getFeishuHandoffBotCredentials } from '@fastgpt/service/core/app/feishuHandoff/bot';
import {
  getFeishuKnowledgeCollection,
  getFeishuKnowledgeDataset
} from '@fastgpt/service/core/app/feishuHandoff/knowledge';
import { authApp } from '@fastgpt/service/support/permission/app/auth';
import { getFeishuOrgCredentials } from '@fastgpt/service/support/user/feishu/client';
import { getFeishuCompanyTeamId } from '@fastgpt/service/support/user/feishu/member';
import { NextAPI } from '@/service/middleware/entry';

export async function handler(req: ApiRequestProps, res: ApiResponseType) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();
  const mutation =
    req.method === 'POST'
      ? parseApiInput({ req, bodySchema: FeishuHandoffConfigBodySchema }).body
      : undefined;
  const appId =
    mutation?.appId ??
    parseApiInput({ req, querySchema: FeishuHandoffConfigQuerySchema }).query.appId;
  const { app, tmbId } = await authApp({
    req,
    appId,
    authToken: true,
    per: WritePermissionVal
  });
  getFeishuOrgCredentials();
  const teamId = await getFeishuCompanyTeamId();
  if (String(app.teamId) !== teamId || !feishuHandoffAppTypes.some((type) => type === app.type)) {
    throw new UserError('此应用无法配置飞书客服');
  }
  const filter = { _id: appId, teamId, deleteTime: null };
  res.setHeader('Cache-Control', 'no-store');

  if (mutation) {
    const { config } = mutation;
    const mining = config.knowledgeMining;
    if (config.enabled && mining?.enabled && mining.datasetId) {
      await getFeishuKnowledgeDataset({ teamId, tmbId, datasetId: mining.datasetId });
      if (mining.targetCollectionId) {
        await getFeishuKnowledgeCollection({
          teamId,
          tmbId,
          datasetId: mining.datasetId,
          collectionId: mining.targetCollectionId
        });
      }
    }
    await updateFeishuHandoffSettings(teamId, async () => {
      if (
        config.defaultGroupId &&
        !(await MongoFeishuHandoffGroup.exists({ teamId, _id: config.defaultGroupId }))
      ) {
        throw new UserError('接待客服组已不可用，请重新选择');
      }
      const result = await MongoApp.updateOne(filter, {
        feishuHandoff: {
          ...config,
          ...(mining && { knowledgeMining: { ...mining, tmbId } })
        }
      });
      if (!result.matchedCount) throw new UserError('应用已删除');
    });
    return;
  }

  const [stored, groups] = await Promise.all([
    MongoApp.findOne(filter).select('feishuHandoff').lean(),
    MongoFeishuHandoffGroup.find({ teamId }, 'name').sort({ name: 1 }).lean()
  ]);
  return FeishuHandoffConfigResponseSchema.parse({
    botConfigured: Boolean(getFeishuHandoffBotCredentials()),
    config: stored?.feishuHandoff ?? { enabled: false },
    groups: groups.map(({ _id, name }) => ({ id: String(_id), name }))
  });
}

export default NextAPI(handler);
