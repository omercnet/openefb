import { safeEqual } from "./limits";

/** HTTP Basic: username ignored, password must equal ADMIN_PASSWORD. Fails closed when unset. */
export function isAdmin(authorization: string | null): boolean {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw || !authorization?.startsWith("Basic ")) return false;
  try {
    const decoded = Buffer.from(authorization.slice(6), "base64").toString("utf8");
    const given = decoded.slice(decoded.indexOf(":") + 1);
    return safeEqual(given, pw);
  } catch {
    return false;
  }
}

export function unauthorized(): Response {
  return new Response("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="admin", charset="UTF-8"' },
  });
}
