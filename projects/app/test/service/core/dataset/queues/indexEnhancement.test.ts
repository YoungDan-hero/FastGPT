import { DatasetDataIndexTypeEnum as IndexType } from '@fastgpt/global/core/dataset/data/constants';
import { TrainingModeEnum } from '@fastgpt/global/core/dataset/constants';
import { runIndexEnhancement } from '@/service/core/dataset/queues/indexEnhancement';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  complete: vi.fn(),
  getModelData: vi.fn(),
  imageInput: vi.fn(),
  recordUsage: vi.fn()
}));

vi.mock('@fastgpt/service/core/ai/llm/request', () => ({ createLLMResponse: mocks.complete }));
vi.mock('@fastgpt/service/core/ai/model/catalog/service', () => ({
  getTeamModelHandle: async () => ({ getModelData: mocks.getModelData })
}));
vi.mock('@fastgpt/service/core/dataset/search/utils', async (original) => ({
  ...(await original<typeof import('@fastgpt/service/core/dataset/search/utils')>()),
  normalizeDatasetIndexImageToModelInput: mocks.imageInput
}));
vi.mock('@fastgpt/service/support/wallet/usage/controller', () => ({
  pushLLMTrainingUsage: mocks.recordUsage
}));

const image = 'dataset/68ad85a7463006c963799a05/diagram.png';
const manualIndex = { type: IndexType.custom, text: '人工添加的索引' };
const description = '流程图显示三步审批，第一步是采购申请。';

const fixture = (mode = TrainingModeEnum.image) => {
  const task = {
    mode,
    datasetId: '68ad85a7463006c963799a05',
    teamId: '68ad85a7463006c963799a06',
    billId: 'test-bill',
    dataset: { agentModelId: 'text-model', vlmModelId: 'vision-model' },
    collection: { autoIndexes: true },
    q: `采购审批流程\n![](${image})`,
    a: `第一步提交采购申请。\n![](${image})`,
    indexes: [manualIndex]
  } as Parameters<typeof runIndexEnhancement>[0];
  const transition = vi.fn().mockResolvedValue(undefined);
  const lease = {
    transition,
    signal: new AbortController().signal,
    assertOwned: vi.fn()
  } as unknown as Parameters<typeof runIndexEnhancement>[1];

  return { task, lease, transition };
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getModelData.mockReturnValue({ modelId: 'fixture-model', config: { maxContext: 16000 } });
  mocks.imageInput.mockResolvedValue('data:image/png;base64,test');
});

describe('local dataset index enhancement', () => {
  it('保留原文和人工索引，依次生成一次图片描述、问题和摘要', async () => {
    const { task, lease, transition } = fixture();
    mocks.complete
      .mockResolvedValueOnce({
        answerText: description,
        usage: { inputTokens: 20, outputTokens: 9 }
      })
      .mockResolvedValueOnce({
        answerText:
          '\x60\x60\x60json\n{"summary":"采购审批从申请开始","questions":["采购第一步是什么？"]}\n\x60\x60\x60',
        usage: { inputTokens: 19, outputTokens: 12 }
      });

    await runIndexEnhancement(task, lease);

    expect(mocks.imageInput).toHaveBeenCalledTimes(1);
    expect(mocks.imageInput).toHaveBeenCalledWith(
      expect.objectContaining({ imageUrl: image, datasetId: task.datasetId })
    );
    expect(transition).toHaveBeenCalledWith({
      mode: TrainingModeEnum.auto,
      indexes: [manualIndex, { type: IndexType.image, text: description }],
      imageDescMap: { [image]: description }
    });

    await runIndexEnhancement({ ...task, ...transition.mock.calls[0][0] }, lease);

    expect(mocks.complete.mock.calls[1][0].body.messages[1].content).toBe(
      '采购审批流程\n\n第一步提交采购申请。'
    );
    expect(transition).toHaveBeenLastCalledWith({
      mode: TrainingModeEnum.index,
      indexes: [
        manualIndex,
        { type: IndexType.image, text: description },
        { type: IndexType.summary, text: '采购审批从申请开始' },
        { type: IndexType.question, text: '采购第一步是什么？' }
      ]
    });
    expect(mocks.recordUsage).toHaveBeenCalledTimes(2);
  });

  it('仅配多模态向量时直接进入向量阶段，遵守单次任务关闭补充索引的设置', async () => {
    const { task, lease, transition } = fixture();
    mocks.getModelData.mockReturnValue(undefined);

    await runIndexEnhancement({ ...task, autoIndexes: false }, lease);

    expect(transition).toHaveBeenCalledWith({ mode: TrainingModeEnum.index });
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it('将无效补充索引报告给队列，保留任务可重试', async () => {
    const { task, lease, transition } = fixture(TrainingModeEnum.auto);
    mocks.complete.mockResolvedValue({ answerText: '无结构的输出', usage: {} });

    await expect(runIndexEnhancement(task, lease)).rejects.toThrow('补充索引格式不正确');
    expect(transition).not.toHaveBeenCalled();
  });
});
