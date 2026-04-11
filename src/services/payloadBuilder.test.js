import { describe, it, expect } from 'vitest';
import { buildChatPayload } from './payloadBuilder.js';

const miniRules = {
  categories: [
    {
      id: 'lateness',
      name: 'Lateness',
      rules: [
        {
          id: '2.01C-5b',
          title: 'Lateness Penalties',
          regulation: '2.01C(5)b(PNW REG)',
          text: '5 minutes or less late: Loss of service toss plus one game.',
        },
      ],
    },
  ],
};

describe('buildChatPayload', () => {
  it('returns an object with model and messages array', () => {
    const payload = buildChatPayload([], miniRules);
    expect(payload).toHaveProperty('model');
    expect(payload).toHaveProperty('messages');
    expect(Array.isArray(payload.messages)).toBe(true);
  });

  it('first message is the system prompt', () => {
    const payload = buildChatPayload([], miniRules);
    expect(payload.messages[0].role).toBe('system');
  });

  it('system prompt contains the rules data', () => {
    const payload = buildChatPayload([], miniRules);
    const systemContent = payload.messages[0].content;
    expect(systemContent).toContain('2.01C(5)b(PNW REG)');
    expect(systemContent).toContain('Lateness Penalties');
  });

  it('system prompt instructs to cite regulation numbers', () => {
    const payload = buildChatPayload([], miniRules);
    const systemContent = payload.messages[0].content;
    expect(systemContent).toMatch(/cite|regulation|reference/i);
  });

  it('appends conversation messages after the system prompt', () => {
    const conversation = [
      { role: 'user', content: 'What if I am late?' },
      { role: 'assistant', content: 'You lose a game.' },
      { role: 'user', content: 'What about 12 minutes?' },
    ];
    const payload = buildChatPayload(conversation, miniRules);
    expect(payload.messages).toHaveLength(4); // 1 system + 3 conversation
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
    const payload = buildChatPayload(conversation, miniRules);
    const roles = payload.messages.map((m) => m.role);
    expect(roles).toEqual(['system', 'user', 'assistant', 'user']);
  });

  it('works with an empty conversation (just system prompt)', () => {
    const payload = buildChatPayload([], miniRules);
    expect(payload.messages).toHaveLength(1);
    expect(payload.messages[0].role).toBe('system');
  });

  it('uses gpt-4o-mini as the default model', () => {
    const payload = buildChatPayload([], miniRules);
    expect(payload.model).toBe('gpt-4o-mini');
  });

  it('sets a low temperature for factual responses', () => {
    const payload = buildChatPayload([], miniRules);
    expect(payload.temperature).toBeLessThanOrEqual(0.3);
  });

  it('system prompt instructs not to guess', () => {
    const payload = buildChatPayload([], miniRules);
    const systemContent = payload.messages[0].content;
    expect(systemContent).toMatch(/never guess|do not.*guess|only.*answer.*using/i);
  });

  it('includes table data in the system prompt', () => {
    const rulesWithTable = {
      categories: [
        {
          id: 'test',
          name: 'Test',
          rules: [
            {
              id: 'T1',
              title: 'Test Rule',
              regulation: 'T.01(PNW REG)',
              text: 'A test rule.',
              table: {
                title: 'Test Table',
                columns: ['Col A', 'Col B'],
                rows: [['val1', 'val2']],
              },
            },
          ],
        },
      ],
    };
    const payload = buildChatPayload([], rulesWithTable);
    const systemContent = payload.messages[0].content;
    expect(systemContent).toContain('Test Table');
    expect(systemContent).toContain('val1');
    expect(systemContent).toContain('Col A');
  });
});
