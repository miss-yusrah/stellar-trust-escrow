/**
 * In-memory TTL cache
 *
 * Lightweight cache for hot read endpoints (leaderboard, reputation, escrow lists).
 * Falls back gracefully — a cache miss just hits the DB.
 *
 * Usage:
 *   cache.set('key', value, ttlSeconds)
 *   cache.get('key')          // returns value or null
 *   cache.invalidate('key')
 *   cache.invalidatePrefix('escrow:')
 */

// Lazy-import metrics to avoid circular deps at startup
let _metrics = null;
async function getMetrics() {
  if (!_metrics) {
    _metrics = await import('./metrics.js');
  }
  return _metrics;
}

/** Extract a short prefix from a cache key for metric labels (e.g. "escrows") */
function keyPrefix(key) {
  return key.split(':')[0] || 'unknown';
}

const store = new Map();

/**
 * @param {string} key
 * @param {*} value
 * @param {number} ttlSeconds  default 60 s
 */
function set(key, value, ttlSeconds = 60) {
  store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

/** @returns {*|null} */
function get(key) {
  const entry = store.get(key);
  const prefix = keyPrefix(key);

  if (!entry || Date.now() > entry.expiresAt) {
    if (entry) store.delete(key);
    getMetrics().then(({ cacheMissesTotal, cacheSize }) => {
      cacheMissesTotal.inc({ key_prefix: prefix });
      cacheSize.set(store.size);
    });
    return null;
  }

  getMetrics().then(({ cacheHitsTotal }) => {
    cacheHitsTotal.inc({ key_prefix: prefix });
  });
  return entry.value;
}

function invalidate(key) {
  store.delete(key);
}

function invalidatePrefix(prefix) {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

/** Expose cache size for health/metrics endpoint */
function size() {
  return store.size;
}

export default { set, get, invalidate, invalidatePrefix, size };
