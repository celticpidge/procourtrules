import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendMessage, sendTranscription } from './api.js';

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

describe('sendTranscription', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('posts audio to /api/transcribe and returns text', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({ text: 'lateness penalties' }),
    });

    const audioBlob = new Blob(['audio-data'], { type: 'audio/webm' });
    const text = await sendTranscription(audioBlob);

    expect(mockFetch).toHaveBeenCalledWith('/api/transcribe', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }));
    expect(text).toBe('lateness penalties');
  });

  it('throws on transcription API errors', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      headers: { get: () => 'application/json' },
      json: async () => ({ error: 'Transcription failed.' }),
    });

    const audioBlob = new Blob(['audio-data'], { type: 'audio/webm' });
    await expect(sendTranscription(audioBlob)).rejects.toThrow('Transcription failed.');
  });

  it('retries on transient network errors and succeeds', async () => {
    mockFetch
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ text: 'line call rules' }),
      });

    const audioBlob = new Blob(['audio-data'], { type: 'audio/webm' });
    const text = await sendTranscription(audioBlob);

    expect(text).toBe('line call rules');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('retries on retryable HTTP status and succeeds', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        headers: { get: () => 'application/json' },
        json: async () => ({ error: 'Service unavailable' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ text: 'court positioning' }),
      });

    const audioBlob = new Blob(['audio-data'], { type: 'audio/webm' });
    const text = await sendTranscription(audioBlob);

    expect(text).toBe('court positioning');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('does not retry on non-retryable HTTP status', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      headers: { get: () => 'application/json' },
      json: async () => ({ error: 'Invalid audio payload.' }),
    });

    const audioBlob = new Blob(['audio-data'], { type: 'audio/webm' });
    await expect(sendTranscription(audioBlob)).rejects.toThrow('Invalid audio payload.');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('throws actionable error when dev server returns non-JSON content', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => 'text/javascript' },
      json: async () => ({ text: 'unused' }),
    });

    const audioBlob = new Blob(['audio-data'], { type: 'audio/webm' });
    await expect(sendTranscription(audioBlob)).rejects.toThrow(/vercel dev|endpoint is not running/i);
  });
});
