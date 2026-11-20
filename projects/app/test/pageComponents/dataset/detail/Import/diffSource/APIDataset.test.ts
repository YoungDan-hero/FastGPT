import React, { act, type ComponentProps } from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { JSDOM } from 'jsdom';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { APIFileItemType } from '@fastgpt/global/core/dataset/apiDataset/type';
import { RootCollectionId } from '@fastgpt/global/core/dataset/collection/constants';
import { DatasetPageContext } from '@/web/core/dataset/context/datasetPageContext';
import { DatasetImportContext } from '@/pageComponents/dataset/detail/Import/Context';
import APIDataset from '@/pageComponents/dataset/detail/Import/diffSource/APIDataset';
import {
  getApiDatasetFileList,
  getApiDatasetFileListExistId
} from '@/web/core/dataset/api/apiDataset';

vi.mock('@/web/core/dataset/api/apiDataset', () => ({
  getApiDatasetFileList: vi.fn(),
  getApiDatasetFileListExistId: vi.fn()
}));
vi.mock('@/web/core/dataset/context/datasetPageContext', async () => ({
  DatasetPageContext: (await import('use-context-selector')).createContext({})
}));
vi.mock('@/pageComponents/dataset/detail/Import/Context', async () => ({
  DatasetImportContext: (await import('use-context-selector')).createContext({})
}));
vi.mock('@fastgpt/web/hooks/useRequest', async () => ({
  useRequest: (await import('ahooks')).useRequest
}));
vi.mock('next/dynamic', () => ({ default: () => () => null }));
vi.mock('next-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}));
vi.mock('@/components/common/folder/Path', () => ({ default: () => null }));
vi.mock('@fastgpt/web/components/common/Icon', () => ({ default: () => null }));

const createFile = (id: string): APIFileItemType => ({
  id,
  rawId: id,
  name: id,
  type: 'file',
  createTime: new Date(),
  updateTime: new Date()
});
const feishuSourceUrl = 'https://example.feishu.cn/docx/example';

describe('API dataset file selection', () => {
  const goToNext = vi.fn();
  const setSources = vi.fn();
  let dom: JSDOM;
  let host: HTMLElement;
  let root: Root;

  const selectAll = () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  const next = () =>
    Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
      button.textContent?.includes('common:next_step')
    )!;

  const render = async (files: APIFileItemType[], isFeishuLink: boolean) => {
    vi.mocked(getApiDatasetFileList).mockResolvedValue(files);
    vi.mocked(getApiDatasetFileListExistId).mockResolvedValue(['imported']);
    const pageValue = {
      datasetDetail: {
        _id: 'dataset-id',
        apiDatasetServer: isFeishuLink ? { feishuApp: { appId: 'cli_example' } } : undefined
      }
    } as ComponentProps<typeof DatasetPageContext.Provider>['value'];
    const importValue = {
      activeStep: 0,
      sources: [],
      goToNext,
      setSources
    } as ComponentProps<typeof DatasetImportContext.Provider>['value'];

    await act(async () => {
      root.render(
        React.createElement(
          ChakraProvider,
          null,
          React.createElement(
            DatasetPageContext.Provider,
            { value: pageValue },
            React.createElement(
              DatasetImportContext.Provider,
              { value: importValue },
              React.createElement(APIDataset)
            )
          )
        )
      );
    });
    if (isFeishuLink) {
      expect(getApiDatasetFileList).not.toHaveBeenCalled();
      await act(async () => {
        const input = host.querySelector<HTMLInputElement>('#feishu-source-link')!;
        input.value = feishuSourceUrl + '?from=share';
        Simulate.change(input);
      });
      await act(async () =>
        host.querySelector<HTMLButtonElement>('button[type="submit"]')!.click()
      );
    }
    await vi.waitFor(() =>
      expect(host.querySelectorAll('input[type="checkbox"]')).toHaveLength(files.length + 1)
    );
    if (isFeishuLink) {
      expect(getApiDatasetFileList).toHaveBeenCalledWith(
        expect.objectContaining({ feishuSourceUrl })
      );
    }
  };

  beforeEach(() => {
    vi.clearAllMocks();
    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
      pretendToBeVisual: true
    });
    vi.stubGlobal('window', dom.window);
    for (const key of ['document', 'Element', 'HTMLElement', 'HTMLInputElement', 'Node'] as const) {
      vi.stubGlobal(key, dom.window[key]);
    }
    vi.stubGlobal('requestAnimationFrame', dom.window.requestAnimationFrame.bind(dom.window));
    vi.stubGlobal('cancelAnimationFrame', dom.window.cancelAnimationFrame.bind(dom.window));
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    host = document.getElementById('root')!;
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    vi.unstubAllGlobals();
  });

  it('disables select all and next when the linked Feishu document is already imported', async () => {
    await render([createFile('imported')], true);

    expect(selectAll().disabled).toBe(true);
    expect(next().disabled).toBe(true);
    await act(async () => selectAll().click());
    expect(next().disabled).toBe(true);
    expect(goToNext).not.toHaveBeenCalled();
  });

  it('passes only new Feishu files forward after select all', async () => {
    await render([createFile('imported'), createFile('new-file')], true);

    await act(async () => selectAll().click());
    expect(next().disabled).toBe(false);
    await act(async () => next().click());

    expect(setSources).toHaveBeenCalledWith([
      expect.objectContaining({ apiFileId: 'new-file', feishuSourceUrl })
    ]);
    expect(goToNext).toHaveBeenCalledOnce();
  });

  it('keeps root selection for sources with nested folders', async () => {
    await render([{ ...createFile('imported'), type: 'folder', hasChild: true }], false);

    await act(async () => selectAll().click());
    await act(async () => next().click());

    expect(setSources).toHaveBeenCalledWith([
      expect.objectContaining({ apiFileId: RootCollectionId })
    ]);
  });
});
