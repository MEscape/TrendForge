/**
 * Simple in-memory TTL cache for serverless environments.
 * Suitable for caching within a single function invocation or warm Lambda.
 */
const store = new Map<string, { data: unknown; expiresAt: number }>();

const DEFAULT_TTL = 15 * 60 * 1000; // 15 minutes

export function getCached<T>(key: string): T | null {
  const entry = store.get(key);
  if (!entry || Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  return entry.data as T;
}

export function setCache(key: string, data: unknown, ttlMs = DEFAULT_TTL) {
  store.set(key, { data, expiresAt: Date.now() + ttlMs });
}

export function invalidateCache(keyPrefix: string) {
  for (const key of store.keys()) {
    if (key.startsWith(keyPrefix)) store.delete(key);
  }
}

/**
 * Run async tasks in batches to respect rate limits.
 */
export async function batchProcess<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  batchSize = 5,
  delayMs = 500
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(batch.map(fn));
    for (const r of batchResults) {
      if (r.status === "fulfilled") results.push(r.value);
    }
    if (i + batchSize < items.length) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return results;
}

