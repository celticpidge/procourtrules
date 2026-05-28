import { track } from '@vercel/analytics';

export function trackTelemetry(eventName, properties = {}) {
  try {
    track(eventName, properties);
  } catch {
    // Keep telemetry best-effort and never break user flows.
  }
}
