const crypto = require("crypto");

/**
 * RFC 3986 percent-encoding: like encodeURIComponent, but also escapes
 * ! * ' ( ) which encodeURIComponent leaves untouched.
 */
function rfc3986(str) {
  return encodeURIComponent(str).replace(
    /[!*'()]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase()
  );
}

/**
 * Build the canonical string BlueAffiliates signs:
 *   - every param except `sig`
 *   - empty values kept as "" (they ARE part of the signature)
 *   - keys sorted ascending ASCII
 *   - key=value pairs, RFC3986-encoded, joined with &
 */
function canonicalize(params) {
  return Object.keys(params)
    .filter((k) => k !== "sig")
    .sort()
    .map((k) => `${rfc3986(k)}=${rfc3986(params[k] ?? "")}`)
    .join("&");
}

/**
 * Verify a postback's {sig} against MY_HMAC_SECRET.
 * Returns true only if the signature is well-formed AND matches
 * (timing-safe compare). Any exception (e.g. malformed sig) => false.
 */
function verifySignature(params, secret) {
  const receivedSig = params.sig;
  if (typeof receivedSig !== "string" || receivedSig.length !== 64) {
    return false;
  }
  if (!/^[0-9a-f]{64}$/i.test(receivedSig)) {
    return false;
  }

  const canonical = canonicalize(params);
  const expected = crypto
    .createHmac("sha256", secret)
    .update(canonical, "utf8")
    .digest("hex");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, "hex"),
      Buffer.from(receivedSig.toLowerCase(), "hex")
    );
  } catch {
    // Buffers of mismatched length etc.
    return false;
  }
}

module.exports = { verifySignature, canonicalize, rfc3986 };
