export default function Header({ onReset }) {
  return (
    <header className="header">
      <h1 className="header-title">Court Rules</h1>
      <p className="header-subtitle">PNW Tennis League Regulations</p>
      {onReset && (
        <button className="header-reset" onClick={onReset} aria-label="New conversation">
          New Chat
        </button>
      )}
    </header>
  );
}
