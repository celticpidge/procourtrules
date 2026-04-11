import { describe, it, expect, beforeEach } from 'vitest';
import { createChatService } from './chatService.js';

describe('chatService', () => {
  let chat;

  beforeEach(() => {
    chat = createChatService();
  });

  it('starts with an empty conversation', () => {
    expect(chat.getMessages()).toEqual([]);
  });

  it('adds a user message with role "user"', () => {
    chat.addUserMessage('What is the lateness penalty?');
    const messages = chat.getMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({
      role: 'user',
      content: 'What is the lateness penalty?',
    });
  });

  it('adds an assistant message with role "assistant"', () => {
    chat.addAssistantMessage('The penalty is loss of toss plus one game.');
    const messages = chat.getMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({
      role: 'assistant',
      content: 'The penalty is loss of toss plus one game.',
    });
  });

  it('maintains insertion order across multiple messages', () => {
    chat.addUserMessage('Question 1');
    chat.addAssistantMessage('Answer 1');
    chat.addUserMessage('Question 2');
    chat.addAssistantMessage('Answer 2');
    const messages = chat.getMessages();
    expect(messages).toHaveLength(4);
    expect(messages.map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
    ]);
    expect(messages[2].content).toBe('Question 2');
  });

  it('rejects empty string messages', () => {
    expect(() => chat.addUserMessage('')).toThrow();
    expect(chat.getMessages()).toEqual([]);
  });

  it('rejects whitespace-only messages', () => {
    expect(() => chat.addUserMessage('   ')).toThrow();
    expect(chat.getMessages()).toEqual([]);
  });

  it('resets the conversation to empty', () => {
    chat.addUserMessage('Hello');
    chat.addAssistantMessage('Hi there');
    chat.reset();
    expect(chat.getMessages()).toEqual([]);
  });

  it('returns a copy of messages, not the internal array', () => {
    chat.addUserMessage('Test');
    const messages = chat.getMessages();
    messages.push({ role: 'user', content: 'Injected' });
    expect(chat.getMessages()).toHaveLength(1);
  });
});
