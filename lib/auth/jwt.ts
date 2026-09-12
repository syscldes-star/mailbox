import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET;
const SESSION_DURATION = "7d";

export interface SessionTokenPayload {
  userId: string;
  workspaceId: string;
}

function getSecret(): string {
  if (!JWT_SECRET) {
    throw new Error(
      "JWT_SECRET is not set. Add a long random string to your .env.local file -- e.g. run `openssl rand -base64 32` to generate one."
    );
  }
  return JWT_SECRET;
}

export function signSessionToken(payload: SessionTokenPayload): string {
  return jwt.sign(payload, getSecret(), { expiresIn: SESSION_DURATION });
}

/** Returns null rather than throwing on an invalid/expired token, since
 * callers should treat that the same as "no session" rather than a
 * distinct error case. */
export function verifySessionToken(token: string): SessionTokenPayload | null {
  try {
    return jwt.verify(token, getSecret()) as SessionTokenPayload;
  } catch {
    return null;
  }
}