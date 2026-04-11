import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendMessage } from './api.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('sendMessage', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('posts messages to /api/chat and returns the response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ message: 'The answer.', remaining: 19 }),
    });

    const result = await sendMessage([{ role: 'user', content: 'Hi' }]);
    expect(mockFetch).toHaveBeenCalledWith('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Hi' }] }),
    });
    expect(result.message).toBe('The answer.');
    expect(result.remaining).toBe(19);
  });

  it('throws with error message on 429 rate limit', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      json: async () => ({ error: 'Daily question limit reached.' }),
    });

    await expect(sendMessage([{ role: 'user', content: 'Hi' }])).rejects.toThrow(
      'Daily question limit reached.'
    );
  });

  it('throws with generic message on other errors', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: async () => ({ error: 'AI service returned an error.' }),
    });

    await expect(sendMessage([{ role: 'user', content: 'Hi' }])).rejects.toThrow();
  });

  it('throws on network failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Failed to fetch'));

    await expect(sendMessage([{ role: 'user', content: 'Hi' }])).rejects.toThrow(
      /network|connection|fetch/i
    );
  });
});
