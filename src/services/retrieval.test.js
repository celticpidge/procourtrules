import { describe, it, expect } from 'vitest';
import { retrieveChunks, formatRetrievedChunks } from './retrieval.js';

const mockChunks = [
  { id: 'pnw-0', source: 'PNW League Regulations', sourceId: 'pnw-league-regs', priority: 1, text: 'Lateness penalties apply after 5 minutes.', embedding: [1, 0, 0] },
  { id: 'pnw-1', source: 'PNW League Regulations', sourceId: 'pnw-league-regs', priority: 1, text: 'Teams must register before the deadline.', embedding: [0, 1, 0] },
  { id: 'itf-0', source: 'ITF Rules of Tennis', sourceId: 'itf-rules', priority: 5, text: 'The server shall stand behind the baseline.', embedding: [0, 0, 1] },
  { id: 'usta-0', source: 'USTA League Regulations', sourceId: 'usta-league-regs', priority: 2, text: 'Default time is 15 minutes after scheduled start.', embedding: [0.9, 0.1, 0] },
];

describe('retrieveChunks', () => {
  it('returns chunks sorted by similarity score', () => {
    const queryEmbedding = [1, 0, 0]; // most similar to pnw-0
    const results = retrieveChunks(queryEmbedding, mockChunks, 4);
    expect(results[0].id).toBe('pnw-0');
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });

  it('respects topK limit', () => {
    const queryEmbedding = [1, 0, 0];
    const results = retrieveChunks(queryEmbedding, mockChunks, 2);
    expect(results).toHaveLength(2);
  });

  it('includes score property on results', () => {
    const queryEmbedding = [1, 0, 0];
    const results = retrieveChunks(queryEmbedding, mockChunks, 1);
    expect(results[0]).toHaveProperty('score');
    expect(typeof results[0].score).toBe('number');
  });

  it('returns perfect score for identical embeddings', () => {
    const queryEmbedding = [1, 0, 0];
    const results = retrieveChunks(queryEmbedding, mockChunks, 1);
    expect(results[0].score).toBeCloseTo(1.0);
  });

  it('returns zero score for orthogonal embeddings', () => {
    const queryEmbedding = [1, 0, 0];
    const results = retrieveChunks(queryEmbedding, mockChunks, 4);
    const itfChunk = results.find((r) => r.id === 'itf-0');
    expect(itfChunk.score).toBeCloseTo(0.0);
  });
});

describe('formatRetrievedChunks', () => {
  it('groups chunks by source', () => {
    const chunks = [
      { source: 'PNW League Regulations', priority: 1, text: 'Rule A' },
      { source: 'PNW League Regulations', priority: 1, text: 'Rule B' },
      { source: 'ITF Rules of Tennis', priority: 5, text: 'Rule C' },
    ];
    const formatted = formatRetrievedChunks(chunks);
    expect(formatted).toContain('=== SOURCE: PNW League Regulations');
    expect(formatted).toContain('=== SOURCE: ITF Rules of Tennis');
    expect(formatted).toContain('Rule A');
    expect(formatted).toContain('Rule B');
    expect(formatted).toContain('Rule C');
  });

  it('sorts sources by priority order', () => {
    const chunks = [
      { source: 'ITF Rules of Tennis', priority: 5, text: 'ITF rule' },
      { source: 'PNW League Regulations', priority: 1, text: 'PNW rule' },
    ];
    const formatted = formatRetrievedChunks(chunks);
    const pnwIdx = formatted.indexOf('PNW League Regulations');
    const itfIdx = formatted.indexOf('ITF Rules of Tennis');
    expect(pnwIdx).toBeLessThan(itfIdx);
  });

  it('combines multiple chunks from same source', () => {
    const chunks = [
      { source: 'PNW League Regulations', priority: 1, text: 'First rule' },
      { source: 'PNW League Regulations', priority: 1, text: 'Second rule' },
    ];
    const formatted = formatRetrievedChunks(chunks);
    const matches = formatted.match(/=== SOURCE: PNW/g);
    expect(matches).toHaveLength(1);
  });
});
