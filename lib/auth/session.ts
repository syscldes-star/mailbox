import { cookies } from "next/headers";
import { signSessionToken, verifySessionToken, type SessionTokenPayload } from "./jwt";

const SESSION_COOKIE_NAME = "n_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days, matches the JWT's own expiry

// Set COOKIE_DOMAIN (e.g. ".vidyarishi.in", with the leading dot) in
// production so this cookie is readable by the website-builder app on
// its own subdomain too -- that's what lets someone move between the
// two apps without logging in twice. Leave unset for local dev, where
// a domain attribute would break cookies on localhost entirely.
const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN || undefined;

export async function createSessionCookie(payload: SessionTokenPayload): Promise<void> {
  const token = signSessionToken(payload);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    domain: COOKIE_DOMAIN,
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete({ name: SESSION_COOKIE_NAME, path: "/", domain: COOKIE_DOMAIN });
}

/**
 * Reads and verifies the session cookie for the current request. Returns
 * null for "not logged in" (missing or invalid/expired cookie) -- callers
 * that require a session should check for null and respond 401 themselves
 * rather than this helper throwing, since "not logged in" is a normal,
 * expected outcome for plenty of routes (e.g. public preview pages).
 */
export async function getSessionPayload(): Promise<SessionTokenPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}