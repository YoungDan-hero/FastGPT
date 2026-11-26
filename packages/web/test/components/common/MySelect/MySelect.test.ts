// @vitest-environment jsdom

import React, { act } from 'react';
import { Box, ChakraProvider } from '@chakra-ui/react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MySelect from '../../../../components/common/MySelect';

describe('MySelect scroll pagination and remote search behavior', () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('renders a small window and searches all options in a large local list', async () => {
    const onChange = vi.fn();
    const list = Array.from({ length: 3478 }, (_, index) => ({
      label: `员工 ${index + 1}`,
      value: `employee-${index + 1}`
    }));

    await act(async () => {
      root.render(
        React.createElement(
          ChakraProvider,
          null,
          React.createElement(MySelect, { isSearch: true, virtualScroll: true, list, onChange })
        )
      );
    });

    expect(container.querySelectorAll('[role="menuitem"]')).toHaveLength(0);
    const trigger = container.querySelector('button')!;
    await act(async () => {
      trigger.click();
    });

    const menu = container.querySelector<HTMLElement>('[role="menu"]')!;
    // Chakra 会在菜单关闭时调用浏览器的 scrollTo，JSDOM 没有实现。
    menu.scrollTo = vi.fn();
    const visibleItems = menu.querySelectorAll('[role="menuitem"]');
    expect(visibleItems.length).toBeGreaterThan(0);
    expect(visibleItems.length).toBeLessThan(30);
    expect(menu.textContent).not.toContain('员工 3478');

    const viewport = visibleItems[0].parentElement!.parentElement!;
    await act(async () => {
      viewport.scrollTop = 1_000_000;
      viewport.dispatchEvent(new Event('scroll'));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    expect(menu.textContent).toContain('员工 3478');
    expect(menu.querySelectorAll('[role="menuitem"]').length).toBeLessThan(30);

    const input = menu.querySelector('input')!;
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set;
      valueSetter?.call(input, '员工 1234');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const matchedItem = menu.querySelector<HTMLButtonElement>('[role="menuitem"]')!;
    expect(matchedItem.textContent).toBe('员工 1234');
    await act(async () => {
      matchedItem.click();
    });
    expect(onChange).toHaveBeenCalledWith('employee-1234');
  });

  it('delegates overflow scrolling to ScrollData and skips client filtering when onSearchChange is provided', async () => {
    const onSearchChange = vi.fn();
    let capturedScrollProps: Record<string, unknown> | undefined;

    const ScrollData = ({ children, ...props }: { children: React.ReactNode }) => {
      capturedScrollProps = props;
      return React.createElement(Box, { 'data-testid': 'scroll-data', ...props }, children);
    };

    await act(async () => {
      root.render(
        React.createElement(
          ChakraProvider,
          null,
          React.createElement(MySelect, {
            isSearch: true,
            onSearchChange,
            ScrollData: ScrollData as any,
            value: 't-1',
            list: [
              { label: 'Alpha Team', value: 't-1' },
              { label: 'Beta Team', value: 't-2' }
            ]
          })
        )
      );
    });

    const trigger = container.querySelector('button')!;
    await act(async () => {
      trigger.click();
    });

    expect(capturedScrollProps).toMatchObject({
      flex: '1 1 auto',
      minH: 0,
      h: 'auto',
      overflowY: 'auto'
    });

    const input = document.body.querySelector('input')!;
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set;
      valueSetter?.call(input, 'UnmatchedKeyword');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(onSearchChange).toHaveBeenCalledWith('UnmatchedKeyword');
    // 远程搜索开启时不做本地二次过滤，保留服务端当前返回项直到新分页结果到达
    expect(document.body.textContent).toContain('Alpha Team');
    expect(document.body.textContent).toContain('Beta Team');
  });
});
