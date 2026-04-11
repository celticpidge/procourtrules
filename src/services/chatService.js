export function createChatService() {
  let messages = [];

  return {
    addUserMessage(content) {
      if (!content || !content.trim()) {
        throw new Error('Message cannot be empty');
      }
      messages.push({ role: 'user', content });
    },

    addAssistantMessage(content) {
      if (!content || !content.trim()) {
        throw new Error('Message cannot be empty');
      }
      messages.push({ role: 'assistant', content });
    },

    getMessages() {
      return [...messages];
    },

    reset() {
      messages = [];
    },
  };
}
