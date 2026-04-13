import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleChatRequest } from './chat.js';

// Mock fetch globally to simulate OpenAI responses
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function makeReq({ body, ip = '127.0.0.1' }) {
  return { body, headers: { 'x-forwarded-for': ip } };
}

function makeRes() {
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(data) {
      res.body = data;
      return res;
    },
  };
  return res;
}

// RAG flow makes 4 fetch calls:
//   1. embedQuery (embeddings)      — parallel with 2
//   2. rewriteQuery (chat)          — parallel with 1
//   3. embedQuery for rewrite text  — only if 2 succeeded
//   4. final chat completions
function mockRagSuccess(assistantContent = 'answer') {
  mockFetch
    // 1. embedQuery — original query embedding
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ embedding: new Array(1536).fill(0) }] }),
    })
    // 2. rewriteQuery — LLM rewrite
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'rewritten search terms' } }],
      }),
    })
    // 3. embedQuery — rewrite embedding
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ embedding: new Array(1536).fill(0) }] }),
    })
    // 4. final chat completions
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { role: 'assistant', content: assistantContent } }],
      }),
    });
}

describe('handleChatRequest', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('rejects request with no messages', async () => {
    const res = makeRes();
    await handleChatRequest(makeReq({ body: {} }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/messages/i);
  });

  it('rejects request with empty messages array', async () => {
    const res = makeRes();
    await handleChatRequest(makeReq({ body: { messages: [] } }), res);
    expect(res.statusCode).toBe(400);
  });

  it('rejects when rate limit is exceeded', async () => {
    const req = makeReq({ body: { messages: [{ role: 'user', content: 'hi' }] }, ip: '10.0.0.99' });
    const res = makeRes();

    // Exhaust the rate limit
    for (let i = 0; i < 50; i++) {
      const r = makeRes();
      mockRagSuccess();
      await handleChatRequest(
        makeReq({ body: { messages: [{ role: 'user', content: `q${i}` }] }, ip: '10.0.0.99' }),
        r
      );
    }

    await handleChatRequest(req, res);
    expect(res.statusCode).toBe(429);
    expect(res.body.error).toMatch(/limit/i);
  });

  it('calls OpenAI and returns the assistant message on success', async () => {
    mockRagSuccess('The penalty is one game.');

    const res = makeRes();
    await handleChatRequest(
      makeReq({ body: { messages: [{ role: 'user', content: 'What if I am late?' }] } }),
      res
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.message).toBe('The penalty is one game.');
  });

  it('returns remaining quota in the response', async () => {
    mockRagSuccess();

    const res = makeRes();
    await handleChatRequest(
      makeReq({ body: { messages: [{ role: 'user', content: 'test' }] }, ip: '10.0.0.50' }),
      res
    );
    expect(res.statusCode).toBe(200);
    expect(typeof res.body.remaining).toBe('number');
  });

  it('returns 502 when OpenAI returns an error', async () => {
    mockFetch
      // 1. embedQuery
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ embedding: new Array(1536).fill(0) }] }),
      })
      // 2. rewriteQuery
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'rewritten terms' } }],
        }),
      })
      // 3. rewrite embedQuery
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ embedding: new Array(1536).fill(0) }] }),
      })
      // 4. final chat completions — fails
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal server error',
        json: async () => ({ error: { message: 'Internal server error' } }),
      });

    const res = makeRes();
    await handleChatRequest(
      makeReq({ body: { messages: [{ role: 'user', content: 'test' }] }, ip: '10.0.0.60' }),
      res
    );
    expect(res.statusCode).toBe(502);
  });

  it('returns 502 when fetch throws a network error', async () => {
    mockFetch
      // 1. embedQuery
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ embedding: new Array(1536).fill(0) }] }),
      })
      // 2. rewriteQuery
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'rewritten terms' } }],
        }),
      })
      // 3. rewrite embedQuery
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ embedding: new Array(1536).fill(0) }] }),
      })
      // 4. final chat completions — network failure
      .mockRejectedValueOnce(new Error('network failure'));

    const res = makeRes();
    await handleChatRequest(
      makeReq({ body: { messages: [{ role: 'user', content: 'test' }] }, ip: '10.0.0.70' }),
      res
    );
    expect(res.statusCode).toBe(502);
    expect(res.body.error).toMatch(/network|failed|unavailable/i);
  });
});
