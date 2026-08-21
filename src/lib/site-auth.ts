/**
 * Computes a deterministic auth token from the site password using HMAC-
 * SHA256 (Web Crypto API — works in both the Edge middleware runtime and
 * the Node API route runtime, so this one function is safe to import from
 * either).
 *
 * This is a lightweight, self-hosted alternative to Vercel's paid
 * password-protection add-on — good enough to keep a personal project
 * private from casual visitors and search engines, not a substitute for
 * real authentication if this app ever holds sensitive multi-user data.
 */
export async function computeSiteToken(password: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, enc.encode("stock-research-platform-site-auth"));
  return bufToHex(signature);
}

function bufToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export const SITE_AUTH_COOKIE = "site_auth";
