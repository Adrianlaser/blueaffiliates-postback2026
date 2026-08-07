# BlueAffiliates S2S Postback Endpoint

Zero-dependency Node.js implementation of the BlueAffiliates server-to-server
postback receiver spec: signature verification, deduplication, test-ping
handling, and fast-ack + async processing.

## Files
- `server.js` — HTTP server (GET + POST form-urlencoded) exposing
  `/postback/blueaffiliates`. This is the only file you run.
- `verifySignature.js` — RFC3986 canonicalization + HMAC-SHA256 verification
  (timing-safe compare), matching the spec's reference implementation.
- `dedupStore.js` — in-memory dedup on `transaction_id` with a 24h TTL.
  **Swap for Redis/DB before running more than one instance** — see the
  comments in the file for why and how.
- `trackerAdapter.js` — the one file you need to edit. It receives the
  verified, deduplicated event and should write it into your actual
  tracker/CRM/DB, joining on `clickid` (preferred) or `player_token`
  (fallback). Currently just logs — replace the marked TODO block.
- `test.js` — unit tests for signature verification (canonicalization,
  tamper detection, RFC3986 escaping). Run with `node test.js`.

## Setup
1. In the BlueAffiliates dashboard (Settings > Postback tracking), create
   your config:
   - URL: `https://YOUR_DOMAIN/postback/blueaffiliates?event={event}&clickid={clickid}&player_token={player_token}&amount={amount}&commission={commission}&currency={currency}&timestamp_hour={timestamp_hour}&campaign_slug={campaign_slug}&transaction_id={transaction_id}&sub1={sub1}&sub2={sub2}&sub3={sub3}&country={country}&sig={sig}`
     (this exact template is also printed to stdout when the server starts)
   - Method: GET (or POST — the server handles both)
   - Events: pick from registration / ftd / deposit / qualification / commission_paid
2. Copy the HMAC secret shown when you create/regenerate the config.
3. Run:
   ```
   BLUEAFFILIATES_HMAC_SECRET=<your secret> PORT=3000 node server.js
   ```
4. Put it behind HTTPS (e.g. a reverse proxy / load balancer with TLS) —
   the spec requires HTTPS only. This server itself speaks plain HTTP,
   matching how you'd typically run behind nginx/Caddy/an ALB.
5. Edit `trackerAdapter.js` to write into your real tracker.

## Behavior per spec
- **Signature**: any request with an invalid `sig` is ack'd with HTTP 200
  but not processed (avoids useless retries), per spec section 3.
- **Dedup**: keyed on `transaction_id` (also sent as the `Idempotency-Key`
  header). Duplicate deliveries are ack'd but not reprocessed.
- **Test pings**: `transaction_id` starting with `test-` is ack'd but never
  written to the tracker.
- **Speed**: the HTTP response is sent immediately after verify+dedup;
  the tracker write happens after, so a slow write can't blow the 5s ack
  window. For real production volume, replace the direct
  `recordConversion()` call in `server.js` with a push onto a queue
  (SQS, BullMQ, etc.).
- **Rate limiting**: a courtesy 429 kicks in above 100 req/min, matching
  BlueAffiliates' own stated cap (they defer excess on their side too).
- **Retries**: nothing in this server needs to implement retry logic —
  that's BlueAffiliates' job (5 attempts, exponential backoff) — this
  server just needs to always return 2xx quickly, which it does even on
  its own internal errors (see the top-level catch in `server.js`).

## Getting clickid / sub1-3 populated
Per spec section 5, those macros are only filled when traffic goes through
your S2S tracking links with tracker params appended, e.g.:
```
https://blue2affiliates.com/g/4tUTxWxw?clickid=MY_CLICK_ID&s1=...&s2=...&s3=...
```
That's a link-building concern on your end, not something this endpoint
can affect — it's mentioned here as a reminder to update your outbound
link generation to append those params.
