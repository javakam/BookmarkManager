// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Popup } from '../../src/ui/popup/Popup';

afterEach(cleanup);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('Popup', () => {
  it('只显示标题和唯一的打开工作台命令', () => {
    const { container } = render(<Popup openManager={vi.fn()} />);

    expect(screen.getByRole('heading', { name: '书签工作台' })).toBeTruthy();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(
      screen.getByRole('button', { name: '打开书签工作台' }),
    ).toBeTruthy();
    expect(container.textContent).toBe('书签工作台打开书签工作台');
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.queryByText(/收藏当前页|设置|使用说明/)).toBeNull();
  });

  it('打开期间禁用按钮并阻止重复提交', () => {
    const request = deferred<void>();
    const openManager = vi.fn(() => request.promise);
    render(<Popup openManager={openManager} />);
    const button = screen.getByRole('button', { name: '打开书签工作台' });

    fireEvent.click(button);
    fireEvent.click(button);

    expect(openManager).toHaveBeenCalledTimes(1);
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it('成功打开后关闭弹窗', async () => {
    const request = deferred<void>();
    const closePopup = vi.fn();
    render(
      <Popup openManager={() => request.promise} closePopup={closePopup} />,
    );

    fireEvent.click(screen.getByRole('button', { name: '打开书签工作台' }));
    expect(closePopup).not.toHaveBeenCalled();
    await act(async () => request.resolve());

    expect(closePopup).toHaveBeenCalledTimes(1);
  });

  it('关闭弹窗失败时保持锁定且不重复打开工作台', async () => {
    const openManager = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const closePopup = vi.fn(() => {
      throw new Error('close blocked');
    });
    render(<Popup openManager={openManager} closePopup={closePopup} />);

    fireEvent.click(screen.getByRole('button', { name: '打开书签工作台' }));
    await waitFor(() => expect(closePopup).toHaveBeenCalledTimes(1));

    expect(screen.queryByText('无法打开书签工作台，请重试')).toBeNull();
    const button = screen.getByRole('button', { name: '打开书签工作台' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');

    fireEvent.click(button);
    expect(openManager).toHaveBeenCalledTimes(1);
  });

  it('打开期间卸载后不再关闭弹窗', async () => {
    const request = deferred<void>();
    const closePopup = vi.fn();
    const { unmount } = render(
      <Popup openManager={() => request.promise} closePopup={closePopup} />,
    );

    fireEvent.click(screen.getByRole('button', { name: '打开书签工作台' }));
    unmount();
    await act(async () => request.resolve());

    expect(closePopup).not.toHaveBeenCalled();
  });

  it('打开失败时保留弹窗、显示错误并允许重试', async () => {
    const openManager = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('blocked'))
      .mockResolvedValueOnce(undefined);
    const closePopup = vi.fn();
    render(<Popup openManager={openManager} closePopup={closePopup} />);

    fireEvent.click(screen.getByRole('button', { name: '打开书签工作台' }));

    expect(
      await screen.findByText('无法打开书签工作台，请重试'),
    ).toBeTruthy();
    expect(closePopup).not.toHaveBeenCalled();
    const button = screen.getByRole('button', { name: '打开书签工作台' });
    expect((button as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(button);
    await waitFor(() => expect(openManager).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(closePopup).toHaveBeenCalledTimes(1));
  });
});
