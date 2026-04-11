export default function MessageBubble({ role, content }) {
  const isUser = role === 'user';
  return (
    <div className={`message ${isUser ? 'message-user' : 'message-assistant'}`}>
      {!isUser && <span className="message-avatar">🎾</span>}
      <div className="message-content">{content}</div>
    </div>
  );
}
