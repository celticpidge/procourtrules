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

  function handleSubmit(e) {
    e.preventDefault();
    if (!input.trim()) return;
    onSend(input.trim());
    setInput('');
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
          <MessageBubble key={i} role={msg.role} content={msg.content} />
        ))}

        {isLoading && <TypingIndicator />}

        {error && (
          <div className="chat-error">{error}</div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <form className="chat-input-form" onSubmit={handleSubmit}>
        <input
          ref={inputRef}
          type="text"
          className="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a question about the rules..."
          disabled={isLoading}
          aria-label="Ask a question"
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
          {remaining} question{remaining !== 1 ? 's' : ''} remaining today
        </div>
      )}
    </div>
  );
}
