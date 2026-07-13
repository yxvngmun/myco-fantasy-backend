import crypto from "crypto";

// Decodes and verifies a HS256 JWT using Node's built-in crypto module.
export function verifyJwt(token, secret) {
  try {
    const [headerB64, payloadB64, signature] = token.split(".");
    if (!headerB64 || !payloadB64 || !signature) {
      return null;
    }

    // Verify signature
    const hmac = crypto.createHmac("sha256", secret);
    hmac.update(`${headerB64}.${payloadB64}`);
    const expectedSignature = hmac.digest("base64url");

    if (signature !== expectedSignature) {
      console.warn("JWT Verification failed: signature mismatch");
      return null;
    }

    // Parse payload
    const payloadJson = Buffer.from(payloadB64, "base64url").toString("utf8");
    const payload = JSON.parse(payloadJson);

    // Check expiration
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      console.warn("JWT Verification failed: token expired");
      return null;
    }

    return payload;
  } catch (err) {
    console.error("JWT verification error:", err.message);
    return null;
  }
}

// Signs a HS256 JWT (useful for generating test tokens)
export function signJwt(payload, secret, expiresInSeconds = 3600) {
  const header = { alg: "HS256", typ: "JWT" };
  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const fullPayload = { ...payload, exp };

  const headerB64 = Buffer.from(JSON.stringify(header)).toString("base64url");
  const payloadB64 = Buffer.from(JSON.stringify(fullPayload)).toString("base64url");

  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(`${headerB64}.${payloadB64}`);
  const signature = hmac.digest("base64url");

  return `${headerB64}.${payloadB64}.${signature}`;
}
