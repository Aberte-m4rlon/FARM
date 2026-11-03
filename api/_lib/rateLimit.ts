interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export function createRateLimiter(maxEntries = 5000) {
  const entries = new Map<string, RateLimitEntry>();

  return (key: string, limit: number, windowMs: number, now = Date.now()) => {
    let entry = entries.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      entries.set(key, entry);
    }

    entry.count += 1;
    if (entries.size > maxEntries) {
      for (const [entryKey, value] of entries) {
        if (value.resetAt <= now) entries.delete(entryKey);
      }
      if (entries.size > maxEntries) {
        entries.delete(key);
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
        };
      }
    }

    return {
      allowed: entry.count <= limit,
      retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
    };
  };
}

// This is an instance-local backstop; production deployments with multiple workers
// should also enforce provider/account quotas or a shared rate-limit store.
export const checkRateLimit = createRateLimiter();
