export default function Header({ onReset }) {
  return (
    <header className="header">
      <img src="/icons/icon-192x192.svg" alt="Pro Court Rules logo" className="header-logo" />
      <h1 className="header-title">Pro Court Rules</h1>
      <p className="header-subtitle">PNW Tennis League Regulations</p>
      {onReset && (
        <button className="header-reset" onClick={onReset} aria-label="New conversation">
          New Chat
        </button>
      )}
    </header>
  );
}
