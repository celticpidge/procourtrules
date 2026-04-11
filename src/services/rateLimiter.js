export function createRateLimiter({ maxRequests, windowMs }) {
  const clients = new Map();

  return {
    check(clientId) {
      const now = Date.now();
      const record = clients.get(clientId);

      if (!record || now - record.windowStart >= windowMs) {
        clients.set(clientId, { windowStart: now, count: 1 });
        return { allowed: true, remaining: maxRequests - 1 };
      }

      if (record.count < maxRequests) {
        record.count++;
        return { allowed: true, remaining: maxRequests - record.count };
      }

      const retryAfter = windowMs - (now - record.windowStart);
      return { allowed: false, remaining: 0, retryAfter };
    },
  };
}
