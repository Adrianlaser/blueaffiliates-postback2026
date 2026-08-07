const crypto = require("crypto");
const { verifySignature, canonicalize } = require("./verifySignature");
const assert = require("assert");

const SECRET = "test_secret_123";

// Build a realistic param set, including empty-string macros
const params = {
  event: "ftd",
  clickid: "abc123",
  player_token: "a".repeat(64),
  amount: "50.00",
  commission: "", // empty for non commission_paid, per spec
  currency: "EUR",
  timestamp_hour: "2026-07-08T20:00:00Z",
  campaign_slug: "peton-signup",
  transaction_id: "txn-9f8e",
  sub1: "",
  sub2: "affid42",
  sub3: "",
  country: "",
};

const canonical = canonicalize(params);
const sig = crypto
  .createHmac("sha256", SECRET)
  .update(canonical, "utf8")
  .digest("hex");

// 1. Valid signature accepted
assert.strictEqual(
  verifySignature({ ...params, sig }, SECRET),
  true,
  "valid signature should verify"
);
console.log("PASS: valid signature accepted");

// 2. Tampered value rejected
assert.strictEqual(
  verifySignature({ ...params, amount: "999.00", sig }, SECRET),
  false,
  "tampered amount should fail verification"
);
console.log("PASS: tampered param rejected");

// 3. Wrong secret rejected
assert.strictEqual(
  verifySignature({ ...params, sig }, "wrong_secret"),
  false,
  "wrong secret should fail verification"
);
console.log("PASS: wrong secret rejected");

// 4. Missing sig rejected
assert.strictEqual(
  verifySignature({ ...params }, SECRET),
  false,
  "missing sig should fail verification"
);
console.log("PASS: missing sig rejected");

// 5. RFC3986 special-char escaping (! * ' ( ) beyond encodeURIComponent defaults)
const specialParams = { foo: "a!b*c'd(e)f", bar: "" };
const specialCanonical = canonicalize(specialParams);
assert.strictEqual(
  specialCanonical,
  "bar=&foo=a%21b%2Ac%27d%28e%29f",
  "special characters must be escaped per RFC3986"
);
console.log("PASS: RFC3986 special character escaping correct");

console.log("\nAll signature tests passed.");
