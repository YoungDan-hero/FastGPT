import {
  assertAppDatasetIndexModelsAvailable,
  getAssertedDatasetEmbeddingModel,
  getDatasetModelReference
} from '../model';
import { getTeamModelHandle } from '../../ai/model/catalog/service';
import { TrainingModeEnum } from '@fastgpt/global/core/dataset/constants';
import { predictDataLimitLength } from '@fastgpt/global/core/dataset/utils';
import {
  type PushDataBody,
  type PushDataResponseType
} from '@fastgpt/global/openapi/core/dataset/data/api';
import { UsageSourceEnum } from '@fastgpt/global/support/wallet/usage/constants';
import { getTrainingModeByCollection } from '../collection/utils';
import {
  preCreateDatasetDataAndPushToTrainingQueue,
  pushDataListToTrainingQueue
} from '../training/controller';
import { getDatasetImageIndexCapability } from '../utils';
import { getAuthorizedModelIds } from '../../../support/permission/model/auth';
import { checkDatasetIndexLimit } from '../../../support/permission/teamLimit';

import { CommonErrEnum } from '@fastgpt/global/common/error/code/common';
import { mongoSessionRun } from '../../../common/mongo/sessionRun';
import type { ClientSession } from '../../../common/mongo';
import { isAuthorizedDatasetFileS3Key } from '../../../common/s3/sources/dataset/key';
import { createTrainingUsage } from '../../../support/wallet/usage/controller';

import type { CollectionWithDatasetType } from '@fastgpt/global/core/dataset/type';

export async function pushDatasetData(
  body: PushDataBody,
  {
    teamId,
    tmbId,
    isRoot,
    collection,
    session
  }: {
    teamId: string;
    tmbId: string;
    isRoot: boolean;
    collection: CollectionWithDatasetType;
    session?: ClientSession;
  }
): Promise<PushDataResponseType> {
  // Adapter 4.9.0: support legacy trainingMode field
  body.trainingType = body.trainingType || body.trainingMode;
  const { billId, data } = body;
  const modelHandle = await getTeamModelHandle({ teamId });
  const authorizedIds = await getAuthorizedModelIds({
    actor: { teamId, tmbId, isRoot },
    handle: modelHandle
  });
  const embeddingModels = await assertAppDatasetIndexModelsAvailable({
    resources: [{ type: 'dataset', id: String(collection.datasetId) }],
    teamId,
    modelHandle,
    authorizedIds
  });
  const vectorModelData = getAssertedDatasetEmbeddingModel(
    embeddingModels,
    String(collection.datasetId)
  );
  const agentModelData = modelHandle.getModelData(
    getDatasetModelReference(collection.dataset, 'agent'),
    { type: 'llm' }
  );
  const vlmModelData = modelHandle.getModelData(
    getDatasetModelReference(collection.dataset, 'vlm'),
    { type: 'llm', vision: true, optional: true }
  );

  const mode = getTrainingModeByCollection({
    ...collection,
    ...(body.trainingType && { trainingType: body.trainingType }),
    ...(body.autoIndexes !== undefined && { autoIndexes: body.autoIndexes }),
    ...(body.imageIndex !== undefined && { imageIndex: body.imageIndex }),
    supportImageIndex: getDatasetImageIndexCapability({
      vectorModel: vectorModelData,
      vlmModel: vlmModelData
    }).supportImageIndex
  });

  // auth dataset limit
  await checkDatasetIndexLimit({
    teamId,
    insertLen: predictDataLimitLength(mode, data)
  });

  // imageId 一旦提供，就必须归属于当前已鉴权 collection 的 dataset，避免其他来源的 key 进入训练队列
  const hasInvalidImageKey = data.some(
    ({ imageId }) =>
      imageId !== undefined &&
      !isAuthorizedDatasetFileS3Key({ key: imageId, datasetId: collection.datasetId })
  );
  if (hasInvalidImageKey) {
    return Promise.reject(CommonErrEnum.unAuthFileKey);
  }

  const write = async (session: ClientSession) => {
    const traingUsageId = await (async () => {
      if (billId) return billId;
      const { usageId: newUsageId } = await createTrainingUsage({
        teamId,
        tmbId,
        appName: collection.name,
        billSource: UsageSourceEnum.training,
        vectorModelId: vectorModelData.modelId!,
        agentModelId: agentModelData.modelId,
        vllmModelId: vlmModelData?.modelId,
        session
      });
      return newUsageId;
    })();

    if (mode === TrainingModeEnum.qa) {
      return pushDataListToTrainingQueue({
        ...body,
        session,
        billId: traingUsageId,
        mode,
        teamId,
        tmbId,
        datasetId: collection.datasetId,
        vectorModel: vectorModelData,
        agentModel: agentModelData,
        vlmModel: vlmModelData
      });
    }

    return preCreateDatasetDataAndPushToTrainingQueue({
      ...body,
      session,
      billId: traingUsageId,
      mode, // Use collection's training mode
      teamId,
      tmbId,
      datasetId: collection.datasetId,
      vectorModel: vectorModelData,
      agentModel: agentModelData,
      vlmModel: vlmModelData
    });
  };
  // 审核状态与问答索引任务需要同一事务提交，普通导入仍独立开启事务。
  return session ? write(session) : mongoSessionRun(write);
}
