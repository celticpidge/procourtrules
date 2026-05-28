import { useState, useRef, useEffect } from 'react';
import MessageBubble from './MessageBubble.jsx';
import TypingIndicator from './TypingIndicator.jsx';
import SuggestedQuestions from './SuggestedQuestions.jsx';

export default function ChatWindow({ messages, isLoading, error, remaining, onSend }) {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  function growTextarea(el) {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }

  function handleChange(e) {
    setInput(e.target.value);
    growTextarea(e.target);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!input.trim() || isLoading) return;
      onSend(input.trim());
      setInput('');
      if (inputRef.current) {
        inputRef.current.style.height = 'auto';
      }
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!input.trim()) return;
    onSend(input.trim());
    setInput('');
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
    }
  }

  function handleSuggestion(question) {
    onSend(question);
  }

  return (
    <div className="chat-window">
      <div className="chat-messages">
        {messages.length === 0 && !isLoading && (
          <div className="chat-empty">
            <p className="chat-welcome">
              Ask me anything about PNW tennis league regulations.
            </p>
            <SuggestedQuestions onSelect={handleSuggestion} />
          </div>
        )}

        {messages.map((msg, i) => (
          <MessageBubble
            key={i}
            role={msg.role}
            content={msg.content}
            query={msg.role === 'assistant' && i > 0 ? messages[i - 1].content : undefined}
          />
        ))}

        {isLoading && <TypingIndicator />}

        {error && (
          <div className="chat-error">{error}</div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <form className="chat-input-form" onSubmit={handleSubmit}>
        <textarea
          ref={inputRef}
          className="chat-input"
          value={input}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Ask a question about the rules..."
          disabled={isLoading}
          aria-label="Ask a question"
          rows={1}
        />
        <button
          type="submit"
          className="chat-send"
          disabled={isLoading || !input.trim()}
          aria-label="Send"
        >
          ➤
        </button>
      </form>

      {remaining !== null && (
        <div className="chat-remaining">
          {50 - remaining} of 50 questions used today
        </div>
      )}
    </div>
  );
}
