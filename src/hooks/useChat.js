import { useState, useCallback } from 'react';
import { sendMessage } from '../utils/api.js';
import cachedAnswers from '../data/cachedAnswers.json';

export function useChat() {
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [remaining, setRemaining] = useState(null);

  const send = useCallback(async (content) => {
    if (!content || !content.trim()) return;

    const userMessage = { role: 'user', content };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);

    const cached = cachedAnswers[content];
    if (cached && updatedMessages.length === 1) {
      setMessages((prev) => [...prev, { role: 'assistant', content: cached }]);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const data = await sendMessage(updatedMessages);
      setMessages((prev) => [...prev, { role: 'assistant', content: data.message }]);
      setRemaining(data.remaining);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [messages]);

  const reset = useCallback(() => {
    setMessages([]);
    setError(null);
    setRemaining(null);
  }, []);

  return { messages, isLoading, error, remaining, send, reset };
}
