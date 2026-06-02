import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePwaInstall } from './usePwaInstall.js';

const IOS_SAFARI_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const IOS_CHROME_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1';
const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

function setEnv({ ua, standalone = false, displayStandalone = false }) {
  vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(ua);
  window.navigator.standalone = standalone;
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: displayStandalone && query.includes('standalone'),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

describe('usePwaInstall', () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete window.navigator.standalone;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the hint on iOS Safari when not standalone and not dismissed', () => {
    setEnv({ ua: IOS_SAFARI_UA });
    const { result } = renderHook(() => usePwaInstall());
    expect(result.current.showInstallHint).toBe(true);
  });

  it('does not show on desktop browsers', () => {
    setEnv({ ua: DESKTOP_UA });
    const { result } = renderHook(() => usePwaInstall());
    expect(result.current.showInstallHint).toBe(false);
  });

  it('does not show in iOS Chrome (cannot add to home screen)', () => {
    setEnv({ ua: IOS_CHROME_UA });
    const { result } = renderHook(() => usePwaInstall());
    expect(result.current.showInstallHint).toBe(false);
  });

  it('does not show when already running standalone (navigator.standalone)', () => {
    setEnv({ ua: IOS_SAFARI_UA, standalone: true });
    const { result } = renderHook(() => usePwaInstall());
    expect(result.current.showInstallHint).toBe(false);
  });

  it('does not show when display-mode is standalone', () => {
    setEnv({ ua: IOS_SAFARI_UA, displayStandalone: true });
    const { result } = renderHook(() => usePwaInstall());
    expect(result.current.showInstallHint).toBe(false);
  });

  it('does not show when previously dismissed', () => {
    window.localStorage.setItem('pcr_install_dismissed', '1');
    setEnv({ ua: IOS_SAFARI_UA });
    const { result } = renderHook(() => usePwaInstall());
    expect(result.current.showInstallHint).toBe(false);
  });

  it('hides and persists dismissal when dismiss() is called', () => {
    setEnv({ ua: IOS_SAFARI_UA });
    const { result } = renderHook(() => usePwaInstall());
    expect(result.current.showInstallHint).toBe(true);

    act(() => {
      result.current.dismiss();
    });

    expect(result.current.showInstallHint).toBe(false);
    expect(window.localStorage.getItem('pcr_install_dismissed')).toBe('1');
  });
});
