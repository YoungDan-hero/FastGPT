import { LeaseCache, isRedisLeaseError } from '@fastgpt/dal/redis/caches/lease';
import pLimit from 'p-limit';
import { UserError } from '@fastgpt/global/common/error/utils';
import { AppErrEnum } from '@fastgpt/global/common/error/code/app';
import { feishuHandoffAppTypes } from '@fastgpt/global/core/app/feishuHandoff';
import {
  DatasetCollectionDataProcessModeEnum,
  DatasetCollectionTypeEnum
} from '@fastgpt/global/core/dataset/constants';
import type {
  FeishuHandoffDatasetKnowledgePage,
  FeishuHandoffKnowledgeCounts,
  FeishuHandoffKnowledgeList,
  FeishuHandoffKnowledgeReview
} from '@fastgpt/global/openapi/core/app/feishuHandoff/api';
import { WritePermissionVal } from '@fastgpt/global/support/permission/constant';
import type { TeamTmbItemType } from '@fastgpt/global/support/user/team/type';
import { Types } from '../../../common/mongo';
import { mongoSessionRun } from '../../../common/mongo/sessionRun';
import { authAppByTmbId } from '../../../support/permission/app/auth';
import { createOneCollection } from '../../dataset/collection/controller';
import { MongoDatasetCollection } from '../../dataset/collection/schema';
import { MongoDatasetData } from '../../dataset/data/schema';
import { pushDatasetData } from '../../dataset/data/pushData';
import { getFeishuKnowledgeCollection, getFeishuKnowledgeDataset } from './knowledge';
import { MongoFeishuHandoffCandidate, MongoFeishuHandoffTranscript } from './schema';

const lease = new LeaseCache();
type ReviewActor = {
  teamId: string;
  tmbId: string;
  isRoot: boolean;
  tmbInfo?: Pick<TeamTmbItemType, 'teamId' | 'permission'>;
};

/** 两个审核入口共用应用写入权限，并限制来源应用类型及团队归属。 */
export async function authFeishuHandoffReviewApp(appId: string, actor: ReviewActor) {
  const { app } = await authAppByTmbId({
    appId,
    tmbId: actor.tmbId,
    isRoot: actor.isRoot,
    tmbInfo: actor.tmbInfo,
    per: WritePermissionVal
  });
  if (
    String(app.teamId) !== actor.teamId ||
    !feishuHandoffAppTypes.some((type) => type === app.type)
  ) {
    throw AppErrEnum.unAuthApp;
  }
  return app;
}

/** 审核列表与待审计数共用来源应用、目标库的写入权限。 */
async function getPendingReviewScope({
  appId,
  datasetIds,
  actor
}: {
  appId?: string;
  datasetIds?: string[];
  actor: ReviewActor;
}) {
  const pending = {
    teamId: new Types.ObjectId(actor.teamId),
    status: 'pending' as const,
    ...(datasetIds && { datasetId: { $in: datasetIds.map((id) => new Types.ObjectId(id)) } })
  };
  const limit = pLimit(8);
  const apps = appId
    ? [await authFeishuHandoffReviewApp(appId, actor)]
    : await Promise.all(
        (await MongoFeishuHandoffCandidate.distinct('appId', pending)).map((id) =>
          limit(async () => {
            try {
              return await authFeishuHandoffReviewApp(String(id), actor);
            } catch (error) {
              if (error === AppErrEnum.unAuthApp || error === AppErrEnum.unExist) return;
              throw error;
            }
          })
        )
      );
  const appNames = new Map(
    apps.flatMap((app) => (app ? [[String(app._id), app.name] as const] : []))
  );
  const allowedApps = {
    ...pending,
    appId: { $in: Array.from(appNames.keys(), (id) => new Types.ObjectId(id)) }
  };
  const targets = new Map<string, string>();
  await Promise.all(
    (await MongoFeishuHandoffCandidate.distinct('datasetId', allowedApps)).map((id) =>
      limit(async () => {
        const datasetId = String(id);
        const dataset = await getFeishuKnowledgeDataset({ ...actor, datasetId }).catch(
          () => undefined
        );
        if (dataset) targets.set(datasetId, dataset.name);
      })
    )
  );
  return {
    appNames,
    targets,
    filter: {
      ...allowedApps,
      datasetId: { $in: Array.from(targets.keys(), (id) => new Types.ObjectId(id)) }
    }
  };
}

type PendingReviewScope = Awaited<ReturnType<typeof getPendingReviewScope>>;
type PendingReviewFilter = PendingReviewScope['filter'] & {
  targetCollectionId?: Types.ObjectId | null;
};

/** 只给有写入权限的目标集合解析名称。失效目标仍可在待审列表中看到。 */
async function getReviewCollectionNames(
  collections: { datasetId: string; collectionId: string }[],
  actor: ReviewActor
) {
  const targets = new Map(
    collections.map((target) => [`${target.datasetId}:${target.collectionId}`, target])
  );
  const limit = pLimit(8);
  return new Map(
    await Promise.all(
      Array.from(targets, ([key, target]) =>
        limit(async () => {
          const collection = await getFeishuKnowledgeCollection({
            ...actor,
            ...target
          }).catch(() => undefined);
          return [key, collection?.name ?? null] as const;
        })
      )
    )
  );
}

/** 读取当前页的候选及其客服证据，历史记录保留原有的自动沉淀集合行为。 */
async function loadPendingReviews({
  scope,
  filter,
  actor,
  offset = 0,
  pageSize = 50,
  collectionNames
}: {
  scope: PendingReviewScope;
  filter: PendingReviewFilter;
  actor: ReviewActor;
  offset?: number;
  pageSize?: number;
  collectionNames?: ReadonlyMap<string, string | null>;
}): Promise<FeishuHandoffKnowledgeList> {
  const { appNames, targets } = scope;
  const candidates = await MongoFeishuHandoffCandidate.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .skip(offset)
    .limit(pageSize)
    .lean();
  if (candidates.length === 0) return [];

  const namedCollections =
    collectionNames ??
    (await getReviewCollectionNames(
      candidates.flatMap(({ datasetId, targetCollectionId }) =>
        targetCollectionId
          ? [{ datasetId: String(datasetId), collectionId: String(targetCollectionId) }]
          : []
      ),
      actor
    ));
  const transcripts = await MongoFeishuHandoffTranscript.find({
    _id: { $in: candidates.map(({ transcriptId }) => transcriptId) },
    appId: scope.filter.appId,
    teamId: actor.teamId,
    expiresAt: { $gt: new Date() }
  })
    .select('appId datasetId messages truncated')
    .lean();
  const sources = new Map(
    transcripts.map((source) => [`${source.appId}:${source.datasetId}:${source._id}`, source])
  );
  return candidates.map((candidate) => {
    const appId = String(candidate.appId);
    const datasetId = String(candidate.datasetId);
    const source = sources.get(`${appId}:${datasetId}:${candidate.transcriptId}`);
    return {
      id: String(candidate._id),
      appId,
      appName: appNames.get(appId) ?? '',
      datasetName: targets.get(datasetId) ?? '',
      ...(candidate.targetCollectionId && {
        collectionName: namedCollections.get(`${datasetId}:${candidate.targetCollectionId}`) ?? null
      }),
      question: candidate.question,
      answer: candidate.answer,
      evidence: candidate.evidence.flatMap((number) => {
        const message = source?.messages[number - 1];
        return message?.role === 'agent' ? [message.text.slice(0, 600)] : [];
      }),
      partialHistory: source?.truncated === true
    };
  });
}

/** 应用内审核入口继续按来源应用查看待审问答。 */
export async function listFeishuHandoffKnowledge({
  appId,
  actor
}: {
  appId?: string;
  actor: ReviewActor;
}): Promise<FeishuHandoffKnowledgeList> {
  const scope = await getPendingReviewScope({ appId, actor });
  return loadPendingReviews({ scope, filter: scope.filter, actor });
}

/** 知识库详情只从当前库读取问答和集合选项。集合筛选始终采用候选记录保存的目标。 */
export async function listDatasetFeishuHandoffKnowledge({
  datasetId: requestedDatasetId,
  targetCollectionId,
  offset,
  pageSize,
  actor
}: {
  datasetId: string;
  targetCollectionId?: string;
  offset: number;
  pageSize: number;
  actor: ReviewActor;
}): Promise<FeishuHandoffDatasetKnowledgePage> {
  const datasetId = String(new Types.ObjectId(requestedDatasetId));
  const scope = await getPendingReviewScope({ datasetIds: [datasetId], actor });
  if (scope.targets.size === 0) return { list: [], total: 0, collections: [] };

  const filter = targetCollectionId
    ? {
        ...scope.filter,
        targetCollectionId:
          targetCollectionId === 'legacy' ? null : new Types.ObjectId(targetCollectionId)
      }
    : scope.filter;
  const [total, collectionIds, hasLegacy] = await Promise.all([
    MongoFeishuHandoffCandidate.countDocuments(filter),
    MongoFeishuHandoffCandidate.distinct('targetCollectionId', {
      ...scope.filter,
      targetCollectionId: { $ne: null }
    }),
    MongoFeishuHandoffCandidate.exists({ ...scope.filter, targetCollectionId: null })
  ]);
  const collectionNames = await getReviewCollectionNames(
    collectionIds.map((id) => ({ datasetId, collectionId: String(id) })),
    actor
  );
  const collections = collectionIds
    .map((id) => ({
      id: String(id),
      name: collectionNames.get(`${datasetId}:${id}`) ?? null
    }))
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
  if (hasLegacy) collections.push({ id: 'legacy', name: '自动沉淀集合（历史）' });

  return {
    total,
    collections,
    list: await loadPendingReviews({ scope, filter, actor, offset, pageSize, collectionNames })
  };
}

/** 知识库卡片按库统计待审记录，统计不受列表分页上限影响。 */
export async function countFeishuHandoffKnowledgeByDataset({
  datasetIds,
  actor
}: {
  datasetIds: string[];
  actor: ReviewActor;
}): Promise<FeishuHandoffKnowledgeCounts> {
  const { filter } = await getPendingReviewScope({ datasetIds, actor });
  const counts = await MongoFeishuHandoffCandidate.aggregate<{
    _id: Types.ObjectId;
    count: number;
  }>([{ $match: filter }, { $group: { _id: '$datasetId', count: { $sum: 1 } } }]);
  return counts.map(({ _id, count }) => ({ datasetId: String(_id), count }));
}

/** 把通过审核的问答交给知识库训练队列，审核与写入同时提交。 */
export async function reviewFeishuHandoffKnowledge({
  request,
  appName,
  actor
}: {
  request: FeishuHandoffKnowledgeReview;
  appName: string;
  actor: ReviewActor;
}) {
  const { teamId, tmbId, isRoot } = actor;
  const filter = {
    _id: request.candidateId,
    appId: request.appId,
    teamId,
    ...(request.datasetId && { datasetId: request.datasetId })
  };
  const candidate = await MongoFeishuHandoffCandidate.findOne(filter).lean();
  if (!candidate) throw new UserError('客服问答已不可用');
  const datasetId = String(candidate.datasetId);
  const dataset = await getFeishuKnowledgeDataset({ ...actor, datasetId });

  try {
    await lease.withLease({
      key: `feishu-handoff-knowledge:${datasetId}`,
      label: 'Feishu handoff knowledge review',
      ttlMs: 30_000,
      fn: async ({ assertValid }) => {
        await mongoSessionRun(async (session) => {
          const current = await MongoFeishuHandoffCandidate.findOne(filter).session(session).lean();
          const status = request.action === 'publish' ? 'published' : 'rejected';
          if (current?.status === status) return;
          if (current?.status !== 'pending') throw new UserError('这条客服问答已审核');
          const review = { reviewedBy: tmbId, reviewedAt: new Date(), status };
          if (request.action === 'reject') {
            assertValid();
            await MongoFeishuHandoffCandidate.updateOne(
              filter,
              { ...review, rejectionReason: request.reason },
              { session }
            );
            return;
          }

          // 采用生成候选时保存的写入集合，旧候选继续使用按应用创建的集合。
          const collectionTarget =
            current.targetCollectionId ??
            (
              await MongoDatasetCollection.findOne({
                teamId,
                datasetId,
                type: DatasetCollectionTypeEnum.virtual,
                'metadata.feishuHandoffAppId': request.appId
              })
                .select('_id')
                .session(session)
                .lean()
            )?._id;
          assertValid();
          const collection = collectionTarget
            ? await getFeishuKnowledgeCollection({
                ...actor,
                datasetId,
                collectionId: String(collectionTarget)
              })
            : (
                await createOneCollection({
                  teamId,
                  tmbId,
                  datasetId,
                  name: `客服沉淀知识 · ${appName}`.slice(0, 80),
                  type: DatasetCollectionTypeEnum.virtual,
                  trainingType: DatasetCollectionDataProcessModeEnum.chunk,
                  metadata: { feishuHandoffAppId: request.appId },
                  session
                })
              ).toObject();
          const collectionId = String(collection._id);
          const { question, answer } = request;
          const duplicate = await MongoDatasetData.exists({
            collectionId,
            datasetId,
            q: question,
            a: answer
          }).session(session);
          if (!duplicate) {
            await pushDatasetData(
              { collectionId, data: [{ q: question, a: answer }] },
              { teamId, tmbId, isRoot, collection: { ...collection, dataset }, session }
            );
          }
          assertValid();
          await MongoFeishuHandoffCandidate.updateOne(
            filter,
            { ...review, collectionId, question, answer },
            { session }
          );
        });
      }
    });
  } catch (error) {
    if (isRedisLeaseError(error)) throw new UserError('正在提交其他审核，请稍后重试');
    throw error;
  }
}
