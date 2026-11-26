import { JSDOM } from 'jsdom';
import React, { act, useEffect, useState, type PropsWithChildren } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { defaultFeishuHandoffAutoClose } from '@fastgpt/global/core/app/feishuHandoff';
import { DatasetCollectionTypeEnum, DatasetTypeEnum } from '@fastgpt/global/core/dataset/constants';
import type {
  FeishuHandoffConfigResponse,
  FeishuHandoffKnowledgeList
} from '@fastgpt/global/openapi/core/app/feishuHandoff/api';

const mocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
  getCandidates: vi.fn(),
  getDatasetCandidates: vi.fn(),
  submitReview: vi.fn(),
  save: vi.fn(),
  listDatasets: vi.fn(),
  getDataset: vi.fn(),
  listCollections: vi.fn()
}));

vi.mock('@/web/core/app/api/feishuHandoff', () => ({
  getFeishuHandoffConfig: mocks.getConfig,
  getFeishuHandoffKnowledge: mocks.getCandidates,
  getDatasetFeishuHandoffKnowledge: mocks.getDatasetCandidates,
  updateFeishuHandoffConfig: mocks.save,
  submitFeishuHandoffKnowledgeReview: mocks.submitReview
}));
vi.mock('@/web/core/dataset/api', () => ({
  getDatasetsV2: mocks.listDatasets,
  getDatasetById: mocks.getDataset
}));
vi.mock('@/web/core/dataset/api/collection', () => ({
  getDatasetCollections: mocks.listCollections,
  getDatasetCollectionById: vi.fn()
}));
vi.mock('@fastgpt/web/components/common/MySelect', () => ({
  default: ({
    id,
    value,
    list,
    onChange
  }: {
    id: string;
    value: string;
    list: { value: string; label: string }[];
    onChange: (value: string) => void;
  }) =>
    React.createElement(
      'select',
      {
        id,
        value,
        onChange: (event: React.ChangeEvent<HTMLSelectElement>) => onChange(event.target.value)
      },
      React.createElement('option', { value: '' }),
      list.map(({ value, label }) => React.createElement('option', { key: value, value }, label))
    )
}));
vi.mock('@fastgpt/web/hooks/useRequest', () => ({
  useRequest: <T>(
    request: () => Promise<T>,
    options: { manual?: boolean; onSuccess?: (response: T) => void; refreshDeps?: unknown[] }
  ) => {
    const [data, setData] = useState<T>();
    useEffect(() => {
      if (options.manual !== false) return;
      void request().then((response) => {
        setData(response);
        options.onSuccess?.(response);
      });
    }, options.refreshDeps ?? []);
    return { data, loading: options.manual === false && data === undefined, run: request };
  }
}));
vi.mock('@chakra-ui/react', () => {
  const Container = ({ children }: PropsWithChildren) => React.createElement('div', null, children);
  return {
    Alert: Container,
    AlertIcon: Container,
    Box: Container,
    Button: ({
      children,
      onClick,
      isDisabled
    }: PropsWithChildren<{ onClick: () => void; isDisabled?: boolean }>) =>
      React.createElement('button', { onClick, disabled: isDisabled }, children),
    Flex: Container,
    FormControl: Container,
    FormHelperText: Container,
    FormLabel: Container,
    Input: Container,
    Select: ({
      children,
      id,
      value,
      onChange
    }: PropsWithChildren<{
      id: string;
      value: string;
      onChange: React.ChangeEventHandler<HTMLSelectElement>;
    }>) => React.createElement('select', { id, value, onChange }, children),
    SimpleGrid: Container,
    Spinner: Container,
    Stack: Container,
    Switch: Container,
    Text: Container,
    Textarea: Container
  };
});
vi.mock('@/components/core/chat/ChatContainer/ChatBox/components/FeishuHandoffModal', () => ({
  FeishuHandoffModal: ({
    children,
    title,
    actions
  }: PropsWithChildren<{ title: string; actions: React.ReactNode }>) =>
    React.createElement('section', null, React.createElement('h2', null, title), children, actions),
  handoffFieldStyle: {},
  handoffPrimaryAction: {},
  handoffSecondaryAction: {}
}));

import FeishuHandoffSettings from '@/pageComponents/app/detail/FeishuHandoffSettings';
import FeishuHandoffKnowledgeReview from '@/pageComponents/app/detail/FeishuHandoffKnowledgeReview';

const id = '68ee0bd23d17260b7829b137';
const collectionId = '68ee0bd23d17260b7829b138';
const configResponse: FeishuHandoffConfigResponse = {
  botConfigured: true,
  config: {
    enabled: true,
    defaultGroupId: id,
    autoClose: { ...defaultFeishuHandoffAutoClose, enabled: true },
    knowledgeMining: { enabled: true, datasetId: id, retainDays: 30 }
  },
  groups: [{ id, name: '客服组' }]
};
const candidate: FeishuHandoffKnowledgeList[number] = {
  id,
  appId: id,
  appName: '客服应用',
  question: '怎么取测试样品？',
  answer: '带预约号领取。',
  evidence: [],
  partialHistory: false,
  datasetName: '测试知识库'
};

let dom: JSDOM;
beforeEach(() => {
  vi.clearAllMocks();
  dom = new JSDOM('<!doctype html><html><body></body></html>');
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  mocks.getConfig.mockResolvedValue(configResponse);
  mocks.listDatasets.mockResolvedValue({ list: [] });
  mocks.getDataset.mockResolvedValue({
    _id: id,
    name: '飞书资料库',
    type: DatasetTypeEnum.feishu,
    permission: { hasWritePer: true }
  });
  mocks.listCollections.mockResolvedValue({ list: [] });
});

afterEach(() => {
  dom.window.close();
  vi.unstubAllGlobals();
});

it.each([
  { candidates: [], expectedText: '暂无待审核的客服问答。' },
  { candidates: [candidate], expectedText: candidate.question }
])('单独显示审核内容 $expectedText 并允许返回设置', async ({ candidates, expectedText }) => {
  mocks.getCandidates.mockResolvedValue(candidates);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const click = async (label: string) => {
    const button = Array.from(host.querySelectorAll('button')).find(
      (item) => item.textContent === label
    );
    expect(button).toBeDefined();
    await act(async () => button?.click());
  };
  try {
    await act(async () =>
      root.render(React.createElement(FeishuHandoffSettings, { appId: id, onClose: vi.fn() }))
    );
    expect(host.textContent).toContain('沉淀知识库');

    await click('待审核问答');
    expect(mocks.getCandidates).toHaveBeenCalledWith(id);
    expect(host.querySelector('h2')?.textContent).toBe('待审核客服问答');
    expect(host.textContent).toContain(expectedText);
    expect(host.textContent).not.toContain('沉淀知识库');

    await click('返回设置');
    expect(host.querySelector('h2')?.textContent).toBe('人工客服设置');
    expect(host.textContent).toContain('沉淀知识库');
  } finally {
    await act(async () => root.unmount());
  }
});

it('从知识库打开时按本库及所选集合查询，并在审核时带上知识库归属', async () => {
  const datasetId = '68ee0bd23d17260b7829b139';
  const otherCollectionId = '68ee0bd23d17260b7829b140';
  const selected = { ...candidate, collectionName: '会话沉淀' };
  const another = {
    ...candidate,
    id: otherCollectionId,
    question: '如何换货？',
    collectionName: '售后答疑'
  };
  mocks.getDatasetCandidates.mockImplementation(async ({ targetCollectionId }) => {
    const list = targetCollectionId === collectionId ? [selected] : [selected, another];
    return {
      list,
      total: list.length,
      collections: [
        { id: collectionId, name: '会话沉淀' },
        { id: otherCollectionId, name: '售后答疑' }
      ]
    };
  });
  const host = document.createElement('div');
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(React.createElement(FeishuHandoffKnowledgeReview, { datasetId }))
    );
    expect(mocks.getDatasetCandidates).toHaveBeenCalledWith(
      expect.objectContaining({ datasetId, pageNum: 1 })
    );
    expect(host.textContent).toContain(`${candidate.appName} · 会话沉淀`);
    expect(host.textContent).toContain(another.question);
    const select = host.querySelector<HTMLSelectElement>('#handoff-review-collection-filter');
    expect(select).not.toBeNull();
    await act(async () => {
      if (!select) throw new Error('集合筛选未显示');
      select.value = collectionId;
      select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    });
    expect(mocks.getDatasetCandidates).toHaveBeenLastCalledWith(
      expect.objectContaining({ datasetId, targetCollectionId: collectionId, pageNum: 1 })
    );
    expect(host.textContent).not.toContain(another.question);
    await act(async () => host.querySelector('button')?.click());
    const publish = Array.from(host.querySelectorAll('button')).find(
      (button) => button.textContent === '通过并入库'
    );
    expect(publish).toBeDefined();
    await act(async () => publish?.click());
    expect(mocks.submitReview).toHaveBeenCalledWith({
      appId: candidate.appId,
      datasetId,
      action: 'publish',
      candidateId: candidate.id,
      question: candidate.question,
      answer: candidate.answer
    });
  } finally {
    await act(async () => root.unmount());
  }
});

it('用详情接口保留已配的库，并要求选择可写的手动录入集合后才能保存', async () => {
  mocks.listCollections.mockResolvedValue({
    list: [
      {
        _id: collectionId,
        name: '会话沉淀',
        type: DatasetCollectionTypeEnum.virtual,
        permission: { hasWritePer: true }
      },
      {
        _id: id,
        name: '飞书原文',
        type: DatasetCollectionTypeEnum.apiFile,
        permission: { hasWritePer: true }
      }
    ]
  });
  const host = document.createElement('div');
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(React.createElement(FeishuHandoffSettings, { appId: id, onClose: vi.fn() }))
    );
    expect(mocks.getDataset).toHaveBeenCalledWith(id);
    expect(mocks.listDatasets).not.toHaveBeenCalledWith(
      expect.objectContaining({ datasetIds: [id] })
    );
    expect(host.textContent).toContain('飞书资料库');
    const select = host.querySelector<HTMLSelectElement>('#app-handoff-knowledge-collection');
    const save = Array.from(host.querySelectorAll('button')).find(
      (button) => button.textContent === '保存'
    );
    expect(select?.textContent).toBe('会话沉淀');
    expect(save?.disabled).toBe(true);

    await act(async () => {
      if (!select) throw new Error('写入集合选择器未显示');
      select.value = collectionId;
      select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    });

    expect(save?.disabled).toBe(false);
    await act(async () => save?.click());
    expect(mocks.save).toHaveBeenCalledWith({
      appId: id,
      config: {
        ...configResponse.config,
        knowledgeMining: {
          ...configResponse.config.knowledgeMining,
          targetCollectionId: collectionId
        }
      }
    });
  } finally {
    await act(async () => root.unmount());
  }
});
