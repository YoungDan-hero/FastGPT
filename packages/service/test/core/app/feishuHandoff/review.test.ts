import { beforeEach, expect, it, vi } from 'vitest';
import { AppErrEnum } from '@fastgpt/global/common/error/code/app';
import { AppTypeEnum } from '@fastgpt/global/core/app/constants';
import { DatasetCollectionTypeEnum } from '@fastgpt/global/core/dataset/constants';
import { WritePermissionVal } from '@fastgpt/global/support/permission/constant';
import { Types } from '@fastgpt/service/common/mongo';

const mocks = vi.hoisted(() => ({
  authAppByTmbId: vi.fn(),
  getFeishuKnowledgeDataset: vi.fn(),
  authDatasetCollectionByTmbId: vi.fn(),
  pushDatasetData: vi.fn()
}));
vi.mock('@fastgpt/dal/redis/caches/lease', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@fastgpt/dal/redis/caches/lease')>()),
  LeaseCache: class {
    withLease({ fn }: { fn: (context: { assertValid: () => void }) => unknown }) {
      return fn({ assertValid: vi.fn() });
    }
  }
}));
vi.mock('@fastgpt/service/support/permission/app/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@fastgpt/service/support/permission/app/auth')>()),
  authAppByTmbId: mocks.authAppByTmbId
}));
vi.mock('@fastgpt/service/core/app/feishuHandoff/knowledge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@fastgpt/service/core/app/feishuHandoff/knowledge')>()),
  getFeishuKnowledgeDataset: mocks.getFeishuKnowledgeDataset
}));
vi.mock('@fastgpt/service/support/permission/dataset/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@fastgpt/service/support/permission/dataset/auth')>()),
  authDatasetCollectionByTmbId: mocks.authDatasetCollectionByTmbId
}));
vi.mock('@fastgpt/service/core/dataset/data/pushData', () => ({
  pushDatasetData: mocks.pushDatasetData
}));

import {
  countFeishuHandoffKnowledgeByDataset,
  listDatasetFeishuHandoffKnowledge,
  listFeishuHandoffKnowledge,
  reviewFeishuHandoffKnowledge
} from '@fastgpt/service/core/app/feishuHandoff/review';
import {
  MongoFeishuHandoffCandidate,
  MongoFeishuHandoffTranscript
} from '@fastgpt/service/core/app/feishuHandoff/schema';

const teamId = String(new Types.ObjectId());
const otherTeamId = String(new Types.ObjectId());
const appId = String(new Types.ObjectId());
const forbiddenAppId = String(new Types.ObjectId());
const otherTeamAppId = String(new Types.ObjectId());
const datasetId = String(new Types.ObjectId());
const forbiddenDatasetId = String(new Types.ObjectId());
const targetCollectionId = String(new Types.ObjectId());
const actor = { teamId, tmbId: String(new Types.ObjectId()), isRoot: false };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.authAppByTmbId.mockImplementation(async ({ appId: id }) => {
    if (id === forbiddenAppId) throw AppErrEnum.unAuthApp;
    return { app: { _id: id, teamId, name: '客服应用', type: AppTypeEnum.workflow } };
  });
  mocks.getFeishuKnowledgeDataset.mockImplementation(async ({ datasetId: id }) => {
    if (id === forbiddenDatasetId) throw new Error('无知识库写入权限');
    return { name: '客服沉淀库' };
  });
  mocks.authDatasetCollectionByTmbId.mockResolvedValue({
    collection: {
      _id: targetCollectionId,
      teamId,
      datasetId,
      name: '会话沉淀',
      type: DatasetCollectionTypeEnum.virtual
    }
  });
});

it('跨应用列表先限制团队和两种写入权限，再截取最近的问答', async () => {
  const allowed = await MongoFeishuHandoffCandidate.create({
    teamId,
    appId,
    datasetId,
    transcriptId: 'allowed',
    fingerprint: 'allowed',
    question: '如何领取样品？',
    answer: '凭预约号领取。',
    evidence: [1],
    createdAt: new Date(0),
    status: 'pending'
  });
  const newer = {
    teamId,
    appId,
    datasetId,
    transcriptId: 'other',
    question: '不可见问题',
    answer: '不可见回答',
    evidence: [1],
    status: 'pending'
  };
  await MongoFeishuHandoffCandidate.insertMany([
    ...Array.from({ length: 51 }, (_, index) => ({
      ...newer,
      appId: forbiddenAppId,
      fingerprint: `hidden-${index}`
    })),
    { ...newer, datasetId: forbiddenDatasetId, fingerprint: 'no-dataset-write' },
    { ...newer, teamId: otherTeamId, appId: otherTeamAppId, fingerprint: 'other-team' }
  ]);
  await MongoFeishuHandoffTranscript.create({
    _id: 'allowed',
    appId,
    teamId,
    tmbId: actor.tmbId,
    datasetId,
    messages: [{ role: 'agent', text: '凭预约号领取。' }],
    expiresAt: new Date(Date.now() + 60_000)
  });

  await expect(listFeishuHandoffKnowledge({ actor })).resolves.toEqual([
    {
      id: String(allowed._id),
      appId,
      appName: '客服应用',
      datasetName: '客服沉淀库',
      question: '如何领取样品？',
      answer: '凭预约号领取。',
      evidence: ['凭预约号领取。'],
      partialHistory: false
    }
  ]);
  expect(mocks.authAppByTmbId).toHaveBeenCalledWith(
    expect.objectContaining({ appId, per: WritePermissionVal, tmbId: actor.tmbId })
  );
  expect(mocks.authAppByTmbId).not.toHaveBeenCalledWith(
    expect.objectContaining({ appId: otherTeamAppId })
  );
});

it('按应用查看时仍要求该应用的写入权限', async () => {
  await expect(listFeishuHandoffKnowledge({ actor, appId: forbiddenAppId })).rejects.toBe(
    AppErrEnum.unAuthApp
  );
});

it('按库统计全部可审记录，分页和集合筛选只作用于当前库', async () => {
  const otherDatasetId = String(new Types.ObjectId());
  const otherCollectionId = String(new Types.ObjectId());
  const unavailableCollectionId = String(new Types.ObjectId());
  const pending = {
    appId,
    teamId,
    datasetId,
    targetCollectionId,
    status: 'pending' as const,
    evidence: [1],
    question: '如何领取样品？',
    answer: '凭预约号领取。'
  };
  mocks.authDatasetCollectionByTmbId.mockImplementation(async ({ collectionId }) => {
    if (collectionId === unavailableCollectionId) throw new Error('集合不可用');
    return {
      collection: {
        _id: collectionId,
        datasetId,
        teamId,
        name: collectionId === targetCollectionId ? '会话沉淀' : '售后答疑',
        type: DatasetCollectionTypeEnum.virtual
      }
    };
  });
  const rows = [
    ...Array.from({ length: 51 }, (_, index) => ({
      ...pending,
      createdAt: new Date(index + 1),
      question: `样品问题 ${index}`
    })),
    { ...pending, targetCollectionId: otherCollectionId, question: '另一个集合的问题' },
    { ...pending, targetCollectionId: unavailableCollectionId, question: '目标失效的问题' },
    { ...pending, targetCollectionId: undefined, question: '历史问答' },
    { ...pending, datasetId: otherDatasetId, question: '同应用另一个知识库的问题' },
    { ...pending, datasetId: forbiddenDatasetId },
    { ...pending, appId: forbiddenAppId },
    { ...pending, teamId: otherTeamId },
    { ...pending, status: 'published' as const }
  ];
  await MongoFeishuHandoffCandidate.insertMany(
    rows.map((row, index) => ({
      ...row,
      transcriptId: `review-${index}`,
      fingerprint: `review-${index}`
    }))
  );

  const counts = await countFeishuHandoffKnowledgeByDataset({
    datasetIds: [datasetId, otherDatasetId, forbiddenDatasetId],
    actor
  });
  expect(counts).toHaveLength(2);
  expect(counts).toEqual(
    expect.arrayContaining([
      { datasetId, count: 54 },
      { datasetId: otherDatasetId, count: 1 }
    ])
  );

  const scope = { datasetId, actor, offset: 50, pageSize: 1 };
  const page = await listDatasetFeishuHandoffKnowledge({ ...scope, targetCollectionId });
  expect(page.total).toBe(51);
  expect(page.list.map(({ question, collectionName }) => ({ question, collectionName }))).toEqual([
    { question: '样品问题 0', collectionName: '会话沉淀' }
  ]);
  expect(page.collections).toEqual(
    expect.arrayContaining([
      { id: targetCollectionId, name: '会话沉淀' },
      { id: otherCollectionId, name: '售后答疑' },
      { id: unavailableCollectionId, name: null },
      { id: 'legacy', name: '自动沉淀集合（历史）' }
    ])
  );
  const legacy = await listDatasetFeishuHandoffKnowledge({
    ...scope,
    offset: 0,
    targetCollectionId: 'legacy'
  });
  expect(legacy.total).toBe(1);
  expect(legacy.list.map(({ question }) => question)).toEqual(['历史问答']);
});

it.each([datasetId, forbiddenDatasetId])(
  '审核时核对集合实际所属的知识库 %s',
  async (actualDatasetId) => {
    const candidate = await MongoFeishuHandoffCandidate.create({
      teamId,
      appId,
      datasetId,
      targetCollectionId,
      transcriptId: 'selected-target',
      fingerprint: 'selected-target',
      question: '如何领取样品？',
      answer: '凭预约号领取。',
      evidence: [1],
      status: 'pending'
    });
    mocks.authDatasetCollectionByTmbId.mockResolvedValue({
      collection: {
        _id: targetCollectionId,
        teamId,
        datasetId: actualDatasetId,
        name: '会话沉淀',
        type: DatasetCollectionTypeEnum.virtual
      }
    });
    const request = {
      appId,
      datasetId,
      action: 'publish' as const,
      candidateId: String(candidate._id),
      question: candidate.question,
      answer: candidate.answer
    };
    const review = () => reviewFeishuHandoffKnowledge({ request, appName: '客服应用', actor });
    if (actualDatasetId !== datasetId) {
      await expect(review()).rejects.toThrow('请选择该知识库中已启用的手动录入集合');
      expect(mocks.pushDatasetData).not.toHaveBeenCalled();
      return;
    }

    await expect(listFeishuHandoffKnowledge({ actor, appId })).resolves.toMatchObject([
      { datasetName: '客服沉淀库', collectionName: '会话沉淀' }
    ]);
    await expect(
      reviewFeishuHandoffKnowledge({
        request: { ...request, datasetId: forbiddenDatasetId },
        appName: '客服应用',
        actor
      })
    ).rejects.toThrow('客服问答已不可用');
    expect(mocks.pushDatasetData).not.toHaveBeenCalled();
    await review();
    expect(mocks.pushDatasetData).toHaveBeenCalledWith(
      { collectionId: targetCollectionId, data: [{ q: candidate.question, a: candidate.answer }] },
      expect.objectContaining({ collection: expect.objectContaining({ _id: targetCollectionId }) })
    );
    await expect(MongoFeishuHandoffCandidate.findById(candidate._id).lean()).resolves.toMatchObject(
      {
        status: 'published',
        collectionId: targetCollectionId
      }
    );
  }
);
