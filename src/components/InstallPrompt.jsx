import { usePwaInstall } from '../hooks/usePwaInstall.js';

export default function InstallPrompt() {
  const { showInstallHint, dismiss } = usePwaInstall();

  if (!showInstallHint) return null;

  return (
    <div className="install-prompt" role="dialog" aria-label="Install Court Rules">
      <div className="install-prompt-body">
        <img
          src="/icons/apple-touch-icon-180.png"
          alt=""
          className="install-prompt-icon"
        />
        <p className="install-prompt-text">
          Install <strong>Court Rules</strong>: tap the Share
          <span className="install-prompt-share" aria-hidden="true"> ⬆️ </span>
          icon, then <strong>Add to Home Screen</strong>.
        </p>
      </div>
      <button
        className="install-prompt-dismiss"
        onClick={dismiss}
        aria-label="Dismiss install instructions"
      >
        ✕
      </button>
    </div>
  );
}
