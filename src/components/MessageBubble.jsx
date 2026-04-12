import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export default function MessageBubble({ role, content }) {
  const isUser = role === 'user';
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className={`message ${isUser ? 'message-user' : 'message-assistant'}`}>
      {!isUser && <span className="message-avatar">🎾</span>}
      <div className="message-content">
        {isUser ? content : (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        )}
        {!isUser && (
          <button className="copy-button" onClick={handleCopy} aria-label="Copy response">
            {copied ? '✓ Copied' : '⎘ Copy'}
          </button>
        )}
      </div>
    </div>
  );
}
