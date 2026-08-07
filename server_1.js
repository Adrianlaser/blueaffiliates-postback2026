const http = require("http");
const { URL } = require("url");
const { verifySignature } = require("./verifySignature");
const dedupStore = require("./dedupStore");
const { recordConversion } = require("./trackerAdapter");

const PORT = process.env.PORT || 3000;
const MY_HMAC_SECRET = process.env.BLUEAFFILIATES_HMAC_SECRET;
const PATH = "/postback/blueaffiliates";

if (!MY_HMAC_SECRET) {
  console.error(
    "FATAL: BLUEAFFILIATES_HMAC_SECRET env var is not set. " +
      "Get this from the BlueAffiliates dashboard (Settings > Postback tracking) " +
      "when you create/regenerate your config — it's shown once."
  );
  process.exit(1);
}

const VALID_EVENTS = new Set([
  "registration",
  "ftd",
  "deposit",
  "qualification",
  "commission_paid",
]);

// --- simple in-process rate limiter -------------------------------------
// BlueAffiliates caps at 100/min and defers excess on their side, so this
// is a courtesy safety net, not the primary control.
const RATE_LIMIT = 100;
const RATE_WINDOW_MS = 60 * 1000;
let windowStart = Date.now();
let windowCount = 0;

function rateLimiterOk() {
  const now = Date.now();
  if (now - windowStart > RATE_WINDOW_MS) {
    windowStart = now;
    windowCount = 0;
  }
  windowCount += 1;
  return windowCount <= RATE_LIMIT;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1e6) {
        req.destroy();
        reject(new Error("body too large"));
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function paramsFromQuery(searchParams) {
  const out = {};
  for (const [k, v] of searchParams) out[k] = v;
  return out;
}

function send(res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain" });
  res.end(text);
}

// ------------------------------------------------------------------------
// Core handler, shared by GET and POST.
// Per spec: verify sig -> respond 2xx fast -> do the real work async.
// Invalid signature => still ack 200 (per spec, to avoid retry storms),
// just don't process the data.
// ------------------------------------------------------------------------
async function handlePostback(req, res, url) {
  const queryParams = paramsFromQuery(url.searchParams);

  let bodyParams = {};
  if (req.method === "POST") {
    const contentType = req.headers["content-type"] || "";
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const raw = await readBody(req);
      bodyParams = paramsFromQuery(new URLSearchParams(raw));
    }
  }

  // POST body duplicates the query string per spec; merge with body
  // taking precedence if both are somehow present.
  const params = { ...queryParams, ...bodyParams };

  const transactionId = params.transaction_id;
  const eventType = params.event;

  if (!rateLimiterOk()) {
    // Over our own safety threshold; BlueAffiliates defers/retries excess
    // on their end per spec, so a 429 here is safe and expected.
    send(res, 429, "rate limited, retry later");
    return;
  }

  if (!transactionId) {
    console.warn("[postback] missing transaction_id, params:", params);
    send(res, 200, "OK");
    return;
  }

  const valid = verifySignature(params, MY_HMAC_SECRET);
  if (!valid) {
    console.warn(
      `[postback] invalid signature for transaction_id=${transactionId}, event=${eventType}`
    );
    // Per spec: ack 200, do NOT process.
    send(res, 200, "OK");
    return;
  }

  if (eventType && !VALID_EVENTS.has(eventType)) {
    console.warn(
      `[postback] unknown event type "${eventType}" for transaction_id=${transactionId}`
    );
    send(res, 200, "OK");
    return;
  }

  const isTestPing = transactionId.startsWith("test-");

  if (dedupStore.has(transactionId)) {
    // Already processed (BlueAffiliates warns rare double deliveries happen).
    send(res, 200, "OK");
    return;
  }
  dedupStore.mark(transactionId);

  // Ack immediately — delivery contract requires 2xx within 5s.
  send(res, 200, "OK");

  if (isTestPing) {
    // Dashboard "Test" button ping: fake data, event=qualification.
    // Acknowledge (done above) but do not record a real conversion.
    console.log(
      `[postback] test ping received, transaction_id=${transactionId}`
    );
    return;
  }

  // Real work happens after the response is sent. For high volume, push
  // onto a queue (SQS/BullMQ/etc.) here instead of calling directly, so a
  // slow tracker write can never risk the 5s ack window.
  try {
    await recordConversion(params);
  } catch (err) {
    // We've already ack'd 200, so this will NOT trigger a BlueAffiliates
    // retry. Make sure it's logged/alerted somewhere you actually look —
    // this is now the only signal this transaction didn't make it into
    // your tracker.
    console.error(
      `[postback] failed to record conversion for transaction_id=${transactionId}:`,
      err
    );
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (url.pathname !== PATH) {
    send(res, 404, "not found");
    return;
  }
  if (req.method !== "GET" && req.method !== "POST") {
    send(res, 405, "method not allowed");
    return;
  }

  handlePostback(req, res, url).catch((err) => {
    console.error("[postback] unhandled error:", err);
    // Still ack — an unexpected error on our side shouldn't cause
    // BlueAffiliates to hammer us with retries for something a retry
    // won't fix. Investigate via logs instead.
    if (!res.headersSent) send(res, 200, "OK");
  });
});

server.listen(PORT, () => {
  console.log(`BlueAffiliates postback endpoint listening on port ${PORT}`);
  console.log(`Configure in BlueAffiliates dashboard as:`);
  console.log(
    `  https://YOUR_DOMAIN${PATH}?event={event}&clickid={clickid}&player_token={player_token}&amount={amount}&commission={commission}&currency={currency}&timestamp_hour={timestamp_hour}&campaign_slug={campaign_slug}&transaction_id={transaction_id}&sub1={sub1}&sub2={sub2}&sub3={sub3}&country={country}&sig={sig}`
  );
});

module.exports = server;
