export default function TypingIndicator() {
  return (
    <div className="message message-assistant">
      <img src="/icons/icon-ball.svg" alt="" className="message-avatar" />
      <div className="typing-indicator">
        <span></span>
        <span></span>
        <span></span>
      </div>
    </div>
  );
}
