import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRateLimiter } from './rateLimiter.js';

describe('rateLimiter', () => {
  let limiter;

  beforeEach(() => {
    limiter = createRateLimiter({ maxRequests: 20, windowMs: 24 * 60 * 60 * 1000 });
  });

  it('allows the first request', () => {
    const result = limiter.check('user-1');
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(19);
  });

  it('allows up to maxRequests', () => {
    for (let i = 0; i < 20; i++) {
      const result = limiter.check('user-1');
      expect(result.allowed).toBe(true);
    }
  });

  it('blocks the 21st request', () => {
    for (let i = 0; i < 20; i++) {
      limiter.check('user-1');
    }
    const result = limiter.check('user-1');
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('tracks users independently', () => {
    for (let i = 0; i < 20; i++) {
      limiter.check('user-1');
    }
    const result = limiter.check('user-2');
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(19);
  });

  it('resets after the time window expires', () => {
    vi.useFakeTimers();
    try {
      for (let i = 0; i < 20; i++) {
        limiter.check('user-1');
      }
      expect(limiter.check('user-1').allowed).toBe(false);

      // Advance past 24 hours
      vi.advanceTimersByTime(24 * 60 * 60 * 1000 + 1);

      const result = limiter.check('user-1');
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(19);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not reset before the window expires', () => {
    vi.useFakeTimers();
    try {
      for (let i = 0; i < 20; i++) {
        limiter.check('user-1');
      }

      // Advance 23 hours — still within window
      vi.advanceTimersByTime(23 * 60 * 60 * 1000);

      expect(limiter.check('user-1').allowed).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns retryAfter in ms when blocked', () => {
    vi.useFakeTimers();
    try {
      for (let i = 0; i < 20; i++) {
        limiter.check('user-1');
      }
      const result = limiter.check('user-1');
      expect(result.allowed).toBe(false);
      expect(result.retryAfter).toBeGreaterThan(0);
      expect(result.retryAfter).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('remaining count decreases with each request', () => {
    expect(limiter.check('user-1').remaining).toBe(19);
    expect(limiter.check('user-1').remaining).toBe(18);
    expect(limiter.check('user-1').remaining).toBe(17);
  });
});
