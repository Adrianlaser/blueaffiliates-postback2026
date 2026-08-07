/**
 * Deduplication on {transaction_id}.
 *
 * This is an in-memory implementation for local dev / single-instance use.
 * BlueAffiliates says "rare double deliveries can happen" and retries can
 * span up to ~15 minutes (30s+1m+2m+4m+8m backoff), so entries need to
 * live at least that long — we default to 24h to be safe.
 *
 * PRODUCTION NOTE: an in-memory Map is NOT safe if you run more than one
 * process/instance, or if the process restarts during a retry window.
 * Swap this for Redis (SET key NX PX <ttl_ms>) or a DB unique constraint
 * on transaction_id — the interface below (has/mark) is intentionally
 * small so you can drop in a different backend without touching server.js.
 */

const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const seen = new Map(); // transaction_id -> expiry timestamp (ms)

function cleanup() {
  const now = Date.now();
  for (const [key, expiry] of seen) {
    if (expiry <= now) seen.delete(key);
  }
}
setInterval(cleanup, 10 * 60 * 1000).unref();

/** Returns true if this transaction_id has already been processed. */
function has(transactionId) {
  const expiry = seen.get(transactionId);
  if (expiry === undefined) return false;
  if (expiry <= Date.now()) {
    seen.delete(transactionId);
    return false;
  }
  return true;
}

/** Marks a transaction_id as processed. */
function mark(transactionId) {
  seen.set(transactionId, Date.now() + TTL_MS);
}

module.exports = { has, mark };
