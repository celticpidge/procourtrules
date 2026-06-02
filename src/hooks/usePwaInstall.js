import { useEffect, useState } from 'react';

const DISMISS_KEY = 'pcr_install_dismissed';

// True when running as an installed standalone app (iOS or display-mode).
function isStandalone() {
  if (typeof window === 'undefined') return false;
  return (
    window.navigator.standalone === true ||
    (typeof window.matchMedia === 'function' &&
      window.matchMedia('(display-mode: standalone)').matches)
  );
}

// True for iOS Safari (iPhone/iPad), where there is no install prompt and the
// user must use Share -> Add to Home Screen.
function isIosSafari() {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent || '';
  const isIos = /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS 13+ reports as Mac; detect via touch support.
    (ua.includes('Macintosh') && 'ontouchend' in document);
  if (!isIos) return false;
  // Exclude in-app browsers / Chrome on iOS (CriOS) / Firefox (FxiOS) which
  // cannot add to home screen.
  const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
  return isSafari;
}

/**
 * Decides whether to show the iOS "Add to Home Screen" hint.
 * Returns { showInstallHint, dismiss }.
 */
export function usePwaInstall() {
  const [showInstallHint, setShowInstallHint] = useState(false);

  useEffect(() => {
    if (!isIosSafari()) return;
    if (isStandalone()) return;
    let dismissed = false;
    try {
      dismissed = window.localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      dismissed = false;
    }
    if (!dismissed) setShowInstallHint(true);
  }, []);

  const dismiss = () => {
    setShowInstallHint(false);
    try {
      window.localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* ignore storage errors */
    }
  };

  return { showInstallHint, dismiss };
}
