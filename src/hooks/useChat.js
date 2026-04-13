import { useState, useCallback } from 'react';
import { sendMessage } from '../utils/api.js';
import cachedAnswers from '../data/cachedAnswers.json';

const DAILY_LIMIT = 20;

function getQuestionCount() {
  const match = document.cookie.match(/(?:^|; )pcr_count=([^;]+)/);
  const countData = match ? JSON.parse(atob(match[1])) : null;
  const today = new Date().toISOString().slice(0, 10);
  if (countData && countData.d === today) return countData.n;
  return 0;
}

function incrementQuestionCount() {
  const today = new Date().toISOString().slice(0, 10);
  const count = getQuestionCount() + 1;
  const encoded = btoa(JSON.stringify({ d: today, n: count }));
  const expires = new Date();
  expires.setHours(23, 59, 59, 999);
  document.cookie = `pcr_count=${encoded}; expires=${expires.toUTCString()}; path=/; SameSite=Lax`;
  return count;
}

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

    const count = getQuestionCount();
    if (count >= DAILY_LIMIT) {
      setError('Daily question limit reached. Please try again tomorrow.');
      setIsLoading(false);
      return;
    }

    try {
      const data = await sendMessage(updatedMessages);
      incrementQuestionCount();
      setMessages((prev) => [...prev, { role: 'assistant', content: data.message }]);
      setRemaining(DAILY_LIMIT - getQuestionCount());
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
