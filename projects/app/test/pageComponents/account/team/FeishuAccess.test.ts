import React, { act } from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { JSDOM } from 'jsdom';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FeishuAccess from '@/pageComponents/account/team/FeishuAccess';
import type { FeishuAccessResponse } from '@fastgpt/global/openapi/support/user/team/org/api';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  openConfirm: vi.fn((_options: { onConfirm: () => Promise<unknown> }) => vi.fn()),
  toast: vi.fn()
}));

vi.mock('@/web/common/api/request', () => ({ GET: mocks.get, POST: mocks.post }));
vi.mock('@fastgpt/web/hooks/useConfirm', () => ({
  useConfirm: () => ({ openConfirm: mocks.openConfirm, ConfirmModal: () => null })
}));
vi.mock('@fastgpt/web/hooks/useToast', () => ({
  useToast: () => ({ toast: mocks.toast })
}));
vi.mock('@fastgpt/web/components/common/Icon', async () => {
  const { forwardRef } = await import('react');
  return { default: forwardRef(() => null) };
});
vi.mock('next-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'zh-CN' } })
}));

const choices: FeishuAccessResponse = {
  departments: [
    { id: '200000000000000000000001', name: '研发 / 平台组' },
    { id: '200000000000000000000002', name: '市场部' }
  ],
  members: [{ id: '200000000000000000000003', name: '小周' }],
  app: [{ id: '200000000000000000000004', name: '销售陪练' }],
  dataset: [{ id: '200000000000000000000005', name: '产品知识库' }],
  collection: []
};
const endpoint = '/support/user/team/feishu/access';

describe('Feishu organization authorization', () => {
  let dom: JSDOM;
  let host: HTMLElement;
  let root: Root;

  const labelText = (element: HTMLElement) => {
    const clone = element.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('style').forEach((style) => style.remove());
    return clone.textContent?.trim();
  };
  const button = (name: string) => {
    const match = [...host.querySelectorAll('button')].find(
      (item) => item.getAttribute('aria-label') === name || labelText(item) === name
    );
    if (!match) throw new Error(`Missing button ${name}`);
    return match;
  };
  const click = async (name: string) => act(async () => button(name).click());
  const choose = async (label: string, option: string, search?: string) => {
    await click(label);
    const menu = document.getElementById(button(label).getAttribute('aria-controls')!)!;
    const input = menu.querySelector<HTMLInputElement>('input[placeholder="common:Search"]')!;
    expect(input).not.toBeNull();
    if (search) {
      await act(async () => {
        input.value = search;
        Simulate.change(input);
      });
    }
    const options = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    if (search) expect(options.map(labelText)).toEqual([option]);
    const item = options.find((match) => labelText(match) === option);
    if (!item) throw new Error(`Missing option ${option}`);
    await act(async () => item.click());
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.get.mockResolvedValue(choices);
    mocks.post.mockResolvedValue(null);
    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
      pretendToBeVisual: true
    });
    vi.stubGlobal('window', dom.window);
    for (const key of [
      'document',
      'navigator',
      'Element',
      'HTMLElement',
      'HTMLInputElement',
      'SVGElement',
      'Node',
      'Event',
      'MouseEvent',
      'FocusEvent',
      'getComputedStyle'
    ] as const) {
      vi.stubGlobal(key, dom.window[key]);
    }
    vi.stubGlobal('requestAnimationFrame', dom.window.requestAnimationFrame.bind(dom.window));
    vi.stubGlobal('cancelAnimationFrame', dom.window.cancelAnimationFrame.bind(dom.window));
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('React', React);
    host = document.getElementById('root')!;
    root = createRoot(host);
    await act(async () =>
      root.render(React.createElement(ChakraProvider, null, React.createElement(FeishuAccess)))
    );
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    vi.unstubAllGlobals();
  });

  it('previews named targets and submits only the currently selected pair', async () => {
    expect(button('保存授权').disabled).toBe(true);
    await choose('选择部门', '研发 / 平台组', '平台');
    await choose('选择Agent', '销售陪练');
    const preview = host.querySelector('aside')!;
    expect(preview.textContent).toContain('研发 / 平台组');
    expect(preview.textContent).toContain('包含所选部门及其子部门');
    expect(preview.textContent).toContain('销售陪练');

    await click('员工');
    expect(button('保存授权').disabled).toBe(true);
    expect(preview.textContent).not.toContain('研发 / 平台组');
    await choose('选择员工', '小周');
    await click('知识库');
    expect(button('保存授权').disabled).toBe(true);
    expect(preview.textContent).not.toContain('销售陪练');
    await choose('选择知识库', '产品知识库');
    const role = host.querySelector<HTMLInputElement>('input[type="radio"][value="write"]')!;
    await act(async () => role.click());
    await click('保存授权');

    expect(mocks.post).toHaveBeenCalledExactlyOnceWith(endpoint, {
      principal: 'member',
      principalId: choices.members[0].id,
      resource: 'dataset',
      resourceId: choices.dataset[0].id,
      role: 'write'
    });
  });

  it('requires confirmation for removal and disables actions when a refreshed target disappears', async () => {
    await choose('选择部门', '市场部');
    await choose('选择Agent', '销售陪练');
    await click('移除授权');
    expect(mocks.post).not.toHaveBeenCalled();
    const confirmation = mocks.openConfirm.mock.lastCall?.[0];
    expect(confirmation).toMatchObject({
      title: '移除授权？',
      customContent: expect.stringContaining('市场部')
    });
    await act(async () => confirmation?.onConfirm());
    expect(mocks.post).toHaveBeenCalledExactlyOnceWith(
      endpoint,
      expect.objectContaining({ principalId: choices.departments[1].id, role: 'remove' })
    );

    mocks.get.mockResolvedValueOnce({ ...choices, app: [] });
    await click('刷新列表');
    expect(button('保存授权').disabled).toBe(true);
    expect(button('移除授权').disabled).toBe(true);
    expect(host.textContent).toContain('暂无可选Agent');
  });
});
