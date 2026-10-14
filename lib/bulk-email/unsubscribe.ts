// lib/bulk-email/unsubscribe.ts
//
// Signed, non-expiring unsubscribe tokens. Signed with the same
// JWT_SECRET as session tokens, but carry a distinct `purpose` claim so
// one can never be accepted in place of the other.

import jwt from "jsonwebtoken";

interface UnsubscribePayload {
  purpose: "unsubscribe";
  workspaceId: string;
  email: string;
}

function getSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not set.");
  return secret;
}

export function signUnsubscribeToken(workspaceId: string, email: string): string {
  const payload: UnsubscribePayload = { purpose: "unsubscribe", workspaceId, email: email.toLowerCase() };
  return jwt.sign(payload, getSecret());
}

export function verifyUnsubscribeToken(token: string): { workspaceId: string; email: string } | null {
  try {
    const payload = jwt.verify(token, getSecret()) as UnsubscribePayload;
    if (payload.purpose !== "unsubscribe" || !payload.workspaceId || !payload.email) return null;
    return { workspaceId: payload.workspaceId, email: payload.email };
  } catch {
    return null;
  }
}

export function unsubscribeUrl(publicBaseUrl: string, workspaceId: string, email: string): string {
  const base = publicBaseUrl.replace(/\/+$/, "");
  return `${base}/api/unsubscribe?t=${encodeURIComponent(signUnsubscribeToken(workspaceId, email))}`;
}
