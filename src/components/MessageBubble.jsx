import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import FeedbackForm from './FeedbackForm.jsx';

export default function MessageBubble({ role, content, query }) {
  const isUser = role === 'user';
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className={`message ${isUser ? 'message-user' : 'message-assistant'}`}>
      {!isUser && <img src="/icons/icon-ball.svg" alt="" className="message-avatar" />}
      <div className="message-content">
        {isUser ? content : (
          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>{content}</ReactMarkdown>
        )}
        {!isUser && (
          <div className="message-actions">
            <button className="copy-button" onClick={handleCopy} aria-label="Copy response">
              {copied ? '✓ Copied' : '⎘ Copy'}
            </button>
            <FeedbackForm query={query} response={content} />
          </div>
        )}
      </div>
    </div>
  );
}
