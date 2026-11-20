import { NextAPI } from '@/service/middleware/entry';
import { parseParentIdInMongo } from '@fastgpt/global/common/parentFolder/utils';
import { UserError } from '@fastgpt/global/common/error/utils';
import { DatasetCollectionTypeEnum, DatasetTypeEnum } from '@fastgpt/global/core/dataset/constants';
import type { APIFileItemType } from '@fastgpt/global/core/dataset/apiDataset/type';
import {
  CreateDatasetBodySchema,
  CreateDatasetResponseSchema,
  type CreateDatasetResponse
} from '@fastgpt/global/openapi/core/dataset/api';
import {
  AuthUserTypeEnum,
  PerResourceTypeEnum,
  WritePermissionVal
} from '@fastgpt/global/support/permission/constant';
import { TeamDatasetCreatePermissionVal } from '@fastgpt/global/support/permission/user/constant';
import { pushTrack } from '@fastgpt/service/common/middle/tracks/utils';
import { mongoSessionRun } from '@fastgpt/service/common/mongo/sessionRun';
import { getTeamModelHandle } from '@fastgpt/service/core/ai/model/catalog/service';

import { AuditEventEnum } from '@fastgpt/global/support/user/audit/constants';
import type { ApiRequestProps } from '@fastgpt/next/type';
import { getS3AvatarSource } from '@fastgpt/service/common/s3/sources/avatar';
import { getFolderAncestorIdsFromParentId } from '@fastgpt/service/common/parentFolder/ancestorIds';
import { checkCreateResourceParent } from '@fastgpt/service/common/parentFolder/depth';
import { parseApiInput } from '@fastgpt/service/common/zod/requestParseError';
import {
  verifyFeishuDatasetApp,
  verifyFeishuDatasetLink
} from '@fastgpt/service/core/dataset/apiDataset/feishuDataset/link';
import { createApiFileCollectionsBatch } from '@fastgpt/service/core/dataset/collection/controller';
import { MongoDataset } from '@fastgpt/service/core/dataset/schema';
import { createResourceDefaultCollaborators } from '@fastgpt/service/support/permission/controller';
import { authDataset } from '@fastgpt/service/support/permission/dataset/auth';
import { getAuthorizedModelIds } from '@fastgpt/service/support/permission/model/auth';
import {
  checkTeamDatasetFolderLimit,
  checkTeamDatasetLimit
} from '@fastgpt/service/support/permission/teamLimit';
import { authUserPer } from '@fastgpt/service/support/permission/user/auth';
import { addAuditLog, getI18nDatasetType } from '@fastgpt/service/support/user/audit/util';
import { buildDatasetAuditResource } from '@fastgpt/global/support/user/audit/type';
import { getDatasetImageIndexCapability } from '@fastgpt/service/core/dataset/utils';

async function handler(req: ApiRequestProps): Promise<CreateDatasetResponse> {
  const {
    parentId,
    name: requestedName,
    intro,
    type = DatasetTypeEnum.dataset,
    avatar,
    vectorModelId,
    vectorModel,
    agentModelId,
    agentModel,
    vlmModelId,
    vlmModel,
    apiDatasetServer,
    chunkSettings,
    sangforFileParseConfig,
    inheritPermission
  } = parseApiInput({ req, bodySchema: CreateDatasetBodySchema }).body;

  // auth
  const { teamId, tmbId, isRoot, authType } = parentId
    ? await authDataset({
        req,
        datasetId: parentId,
        authToken: true,
        authApiKey: true,
        per: WritePermissionVal
      })
    : await authUserPer({
        req,
        authToken: true,
        authApiKey: true,
        per: TeamDatasetCreatePermissionVal
      });

  await checkCreateResourceParent({
    parentId,
    findResource: (id) => MongoDataset.findOne({ _id: id, teamId }, '_id parentId type').lean(),
    isFolder: type === DatasetTypeEnum.folder,
    isFolderType: (parentType) => parentType === DatasetTypeEnum.folder
  });

  // check model valid & permission
  const modelHandle = await getTeamModelHandle({ teamId });
  const authorizedIds = await getAuthorizedModelIds({
    actor: { teamId, tmbId, isRoot },
    handle: modelHandle
  });
  const vectorModelStore =
    modelHandle.getModelData(
      { modelId: vectorModelId, model: vectorModel },
      { type: 'embedding', optional: true, authorizedIds }
    ) ?? modelHandle.getDefaultModelData('embedding', { authorizedIds });
  const agentModelStore =
    modelHandle.getModelData(
      { modelId: agentModelId, model: agentModel },
      { type: 'llm', optional: true, authorizedIds }
    ) ?? modelHandle.getDefaultModelData('llm', { authorizedIds });
  // 显式空值表示“不设置”，不能再补系统默认或按旧名称恢复；仅未传引用时沿用默认（无权限默认 VLM 自动降级为 undefined）。
  const vlmModelStore = (() => {
    if (vlmModelId !== undefined)
      return modelHandle.getModelData(
        { modelId: vlmModelId },
        { type: 'llm', vision: true, optional: true, authorizedIds }
      );
    if (vlmModel !== undefined)
      return modelHandle.getModelData(
        { model: vlmModel },
        { type: 'llm', vision: true, optional: true, authorizedIds }
      );
    return modelHandle.getDefaultModelData('datasetImageLLM', { authorizedIds });
  })();

  // 目录和知识库分别计入不同配额，通用入口应与专用目录入口保持一致。
  if (type === DatasetTypeEnum.folder) {
    await checkTeamDatasetFolderLimit({ teamId });
  } else {
    await checkTeamDatasetLimit(teamId);
  }

  let datasetServer = apiDatasetServer;
  let name = requestedName;
  let feishuFiles: APIFileItemType[] = [];
  let feishuSourceUrl: string | undefined;
  if (type === DatasetTypeEnum.feishu) {
    if (authType !== AuthUserTypeEnum.token) {
      throw new UserError(
        'Feishu dataset requires a login session',
        '请用飞书账号登录后创建知识库。'
      );
    }
    if (
      chunkSettings?.imageIndex &&
      !getDatasetImageIndexCapability({ vectorModel: vectorModelStore, vlmModel: vlmModelStore })
        .supportImageIndex
    ) {
      throw new UserError(
        'Feishu image indexing requires a vision model',
        '请配置图片理解模型或多模态索引模型，再开启图片自动索引。'
      );
    }
    if (apiDatasetServer?.feishuLink) {
      // 旧客户端仍可用链接一次创建知识库和首批文件。
      const { source, title, files } = await verifyFeishuDatasetLink(apiDatasetServer.feishuLink);
      name = requestedName.trim() || title.trim().slice(0, 30) || '飞书知识库';
      datasetServer = { feishuLink: source };
      feishuSourceUrl = source.url;
      feishuFiles = files;
    } else {
      datasetServer = { feishuApp: await verifyFeishuDatasetApp(apiDatasetServer?.feishuApp) };
      name = requestedName.trim() || '飞书知识库';
    }
  } else if (apiDatasetServer?.feishuLink || apiDatasetServer?.feishuApp) {
    throw new UserError('Unexpected Feishu link', '请在飞书知识库中导入飞书链接。');
  }

  const datasetId = await mongoSessionRun(async (session) => {
    const ancestorIds =
      type === DatasetTypeEnum.folder
        ? await getFolderAncestorIdsFromParentId({
            parentId: parentId ? String(parentId) : null,
            findFolder: (id) =>
              MongoDataset.findOne({ _id: id, teamId, type: DatasetTypeEnum.folder })
                .select('_id parentId')
                .session(session)
                .lean()
          })
        : undefined;
    const [dataset] = await MongoDataset.create(
      [
        {
          ...parseParentIdInMongo(parentId),
          ...(ancestorIds ? { ancestorIds } : {}),
          name,
          intro,
          teamId,
          tmbId,
          vectorModelId: vectorModelStore.modelId,
          agentModelId: agentModelStore.modelId,
          ...(vlmModelStore?.modelId && { vlmModelId: vlmModelStore.modelId }),
          avatar,
          type,
          apiDatasetServer: datasetServer,
          ...(sangforFileParseConfig && { sangforFileParseConfig }),
          // folder 与普通知识库均支持独立态创建；未传时 schema 已按继承态解析。
          inheritPermission
        }
      ],
      { session, ordered: true }
    );

    await createResourceDefaultCollaborators({
      resource: dataset,
      resourceType: PerResourceTypeEnum.dataset,
      tmbId,
      session
    });

    if (feishuFiles.length > 0) {
      // 新库和解析任务一并提交，入队失败时也回滚新库。
      await createApiFileCollectionsBatch({
        dataset,
        files: feishuFiles.map(({ id, name }) => ({ name, apiFileId: id, feishuSourceUrl })),
        createCollectionParams: {
          datasetId: String(dataset._id),
          teamId,
          tmbId,
          ...chunkSettings,
          type: DatasetCollectionTypeEnum.apiFile
        },
        modelAuthContext: { modelHandle, authorizedIds },
        session
      });
    }

    await getS3AvatarSource().refreshAvatar(avatar, undefined, session);

    return dataset._id;
  });

  pushTrack.createDataset({
    type,
    teamId,
    tmbId
  });

  (async () => {
    addAuditLog({
      tmbId,
      teamId,
      event: AuditEventEnum.CREATE_DATASET,
      resources: [buildDatasetAuditResource({ _id: datasetId, name, avatar, type })],
      params: {
        datasetName: name,
        datasetType: getI18nDatasetType(type)
      }
    });
  })();

  return CreateDatasetResponseSchema.parse(datasetId);
}
export default NextAPI(handler);
