import { describe, it, expect } from 'vitest';
import { buildChatPayload } from './payloadBuilder.js';

const miniSources = [
  {
    id: 'pnw-league-regs',
    name: 'PNW League Regulations',
    priority: 1,
    description: 'Local section regulations, highest authority.',
    content: '[2.01C(5)b(PNW REG)] Lateness Penalties: 5 minutes or less late: Loss of service toss plus one game.',
  },
  {
    id: 'itf-rules',
    name: 'ITF Rules of Tennis',
    priority: 5,
    description: 'International base rules.',
    content: 'Rule 26: The server shall stand behind the baseline.',
  },
];

describe('buildChatPayload', () => {
  it('returns an object with model and messages array', () => {
    const payload = buildChatPayload([], miniSources);
    expect(payload).toHaveProperty('model');
    expect(payload).toHaveProperty('messages');
    expect(Array.isArray(payload.messages)).toBe(true);
  });

  it('first message is the system prompt', () => {
    const payload = buildChatPayload([], miniSources);
    expect(payload.messages[0].role).toBe('system');
  });

  it('system prompt contains content from all sources', () => {
    const payload = buildChatPayload([], miniSources);
    const systemContent = payload.messages[0].content;
    expect(systemContent).toContain('2.01C(5)b(PNW REG)');
    expect(systemContent).toContain('Lateness Penalties');
    expect(systemContent).toContain('Rule 26');
  });

  it('system prompt labels each source with name and priority', () => {
    const payload = buildChatPayload([], miniSources);
    const systemContent = payload.messages[0].content;
    expect(systemContent).toContain('PNW League Regulations');
    expect(systemContent).toContain('Priority 1');
    expect(systemContent).toContain('ITF Rules of Tennis');
    expect(systemContent).toContain('Priority 5');
  });

  it('system prompt lists sources in priority order', () => {
    const reversed = [...miniSources].reverse();
    const payload = buildChatPayload([], reversed);
    const systemContent = payload.messages[0].content;
    const pnwIdx = systemContent.indexOf('PNW League Regulations');
    const itfIdx = systemContent.indexOf('ITF Rules of Tennis');
    expect(pnwIdx).toBeLessThan(itfIdx);
  });

  it('system prompt includes hierarchy instructions', () => {
    const payload = buildChatPayload([], miniSources);
    const systemContent = payload.messages[0].content;
    expect(systemContent).toMatch(/hierarchy|priority|conflict|override|precedence/i);
  });

  it('system prompt instructs to cite source documents', () => {
    const payload = buildChatPayload([], miniSources);
    const systemContent = payload.messages[0].content;
    expect(systemContent).toMatch(/cite|source|regulation|reference/i);
  });

  it('appends conversation messages after the system prompt', () => {
    const conversation = [
      { role: 'user', content: 'What if I am late?' },
      { role: 'assistant', content: 'You lose a game.' },
      { role: 'user', content: 'What about 12 minutes?' },
    ];
    const payload = buildChatPayload(conversation, miniSources);
    expect(payload.messages).toHaveLength(4);
    expect(payload.messages[1]).toEqual({
      role: 'user',
      content: 'What if I am late?',
    });
    expect(payload.messages[3]).toEqual({
      role: 'user',
      content: 'What about 12 minutes?',
    });
  });

  it('preserves conversation message order', () => {
    const conversation = [
      { role: 'user', content: 'Q1' },
      { role: 'assistant', content: 'A1' },
      { role: 'user', content: 'Q2' },
    ];
    const payload = buildChatPayload(conversation, miniSources);
    const roles = payload.messages.map((m) => m.role);
    expect(roles).toEqual(['system', 'user', 'assistant', 'user']);
  });

  it('works with an empty conversation (just system prompt)', () => {
    const payload = buildChatPayload([], miniSources);
    expect(payload.messages).toHaveLength(1);
    expect(payload.messages[0].role).toBe('system');
  });

  it('uses gpt-5.4-nano as the default model', () => {
    const payload = buildChatPayload([], miniSources);
    expect(payload.model).toBe('gpt-5.4-nano');
  });

  it('sets a low temperature for factual responses', () => {
    const payload = buildChatPayload([], miniSources);
    expect(payload.temperature).toBeLessThanOrEqual(0.5);
  });

  it('system prompt instructs not to guess', () => {
    const payload = buildChatPayload([], miniSources);
    const systemContent = payload.messages[0].content;
    expect(systemContent).toMatch(/never guess|do not.*guess|only.*answer.*using/i);
  });
});

describe('buildChatPayload includes all sources on follow-ups', () => {
  it('includes all sources on first message', () => {
    const conversation = [{ role: 'user', content: 'What if I am late?' }];
    const payload = buildChatPayload(conversation, miniSources);
    const systemContent = payload.messages[0].content;
    expect(systemContent).toContain('PNW League Regulations');
    expect(systemContent).toContain('ITF Rules of Tennis');
  });

  it('includes all sources on follow-up', () => {
    const conversation = [
      { role: 'user', content: 'What if I am late?' },
      { role: 'assistant', content: 'Per the PNW League Regulations, you lose a game.' },
      { role: 'user', content: 'How many minutes?' },
    ];
    const payload = buildChatPayload(conversation, miniSources);
    const systemContent = payload.messages[0].content;
    expect(systemContent).toContain('=== SOURCE: PNW League Regulations');
    expect(systemContent).toContain('=== SOURCE: ITF Rules of Tennis');
  });
});
