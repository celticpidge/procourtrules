import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useChat } from './useChat.js';

vi.mock('../utils/api.js', () => ({
  sendMessage: vi.fn(),
}));

import { sendMessage } from '../utils/api.js';

describe('useChat', () => {
  beforeEach(() => {
    sendMessage.mockReset();
    document.cookie = 'pcr_count=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
  });

  it('starts with no messages and not loading', () => {
    const { result } = renderHook(() => useChat());
    expect(result.current.messages).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBe(null);
  });

  it('adds a user message and calls the API on send', async () => {
    sendMessage.mockResolvedValueOnce({ message: 'Answer', remaining: 19 });

    const { result } = renderHook(() => useChat());

    await act(async () => {
      await result.current.send('What is the lateness rule?');
    });

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0]).toEqual({
      role: 'user',
      content: 'What is the lateness rule?',
    });
    expect(result.current.messages[1]).toEqual({
      role: 'assistant',
      content: 'Answer',
    });
  });

  it('sends full conversation history to the API', async () => {
    sendMessage
      .mockResolvedValueOnce({ message: 'First answer', remaining: 19 })
      .mockResolvedValueOnce({ message: 'Second answer', remaining: 18 });

    const { result } = renderHook(() => useChat());

    await act(async () => {
      await result.current.send('Q1');
    });
    await act(async () => {
      await result.current.send('Q2');
    });

    const lastCall = sendMessage.mock.calls[1][0];
    expect(lastCall).toHaveLength(3); // user Q1, assistant A1, user Q2
  });

  it('sets error on API failure and does not add assistant message', async () => {
    sendMessage.mockRejectedValueOnce(new Error('Daily question limit reached.'));

    const { result } = renderHook(() => useChat());

    await act(async () => {
      await result.current.send('Hi');
    });

    expect(result.current.error).toBe('Daily question limit reached.');
    expect(result.current.messages).toHaveLength(1); // only user message
  });

  it('clears error on next successful send', async () => {
    sendMessage
      .mockRejectedValueOnce(new Error('Fail'))
      .mockResolvedValueOnce({ message: 'OK', remaining: 18 });

    const { result } = renderHook(() => useChat());

    await act(async () => {
      await result.current.send('Q1');
    });
    expect(result.current.error).toBe('Fail');

    await act(async () => {
      await result.current.send('Q2');
    });
    expect(result.current.error).toBe(null);
  });

  it('ignores empty/whitespace-only input', async () => {
    const { result } = renderHook(() => useChat());

    await act(async () => {
      await result.current.send('   ');
    });

    expect(result.current.messages).toEqual([]);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('resets conversation', async () => {
    sendMessage.mockResolvedValueOnce({ message: 'A', remaining: 19 });

    const { result } = renderHook(() => useChat());

    await act(async () => {
      await result.current.send('Q');
    });
    expect(result.current.messages).toHaveLength(2);

    act(() => {
      result.current.reset();
    });
    expect(result.current.messages).toEqual([]);
    expect(result.current.error).toBe(null);
  });

  it('tracks remaining questions', async () => {
    sendMessage.mockResolvedValueOnce({ message: 'A', remaining: 15 });

    const { result } = renderHook(() => useChat());

    await act(async () => {
      await result.current.send('Q');
    });

    // remaining is now derived from cookie counter: DAILY_LIMIT (20) - count (1) = 19
    expect(result.current.remaining).toBe(19);
  });
});
