// lib/integrations/guard.ts
//
// Who sets up integrations (the workspace owner and admins), and the
// keys other apps use for this panel's API (/api/v1).

import { NextRequest } from "next/server";
import { createHash, randomBytes } from "crypto";
import { requireAuth, hasMinimumRole, type AuthContext } from "../api/requireAuth";
import { connectToDatabase } from "../db/mongodb";
import { Workspace } from "../models/Workspace";
import { EmailApiKey, type IEmailApiKey } from "./models";

export async function requireIntegrationsAdmin(): Promise<AuthContext | null> {
  const auth = await requireAuth();
  return auth && hasMinimumRole(auth.membership.role, "admin") ? auth : null;
}

const hashOf = (key: string) => createHash("sha256").update(key).digest("hex");

/** A new key: emlk_<workspaceId>_<secret>. */
export function newEmailKey(workspaceId: string) {
  const key = `emlk_${workspaceId}_${randomBytes(24).toString("base64url")}`;
  return { key, hash: hashOf(key), hint: key.slice(-4) };
}

/** The key of an /api/v1 request (Authorization: Bearer <key>), or null. */
export async function emailKeyAuth(req: NextRequest): Promise<{ key: IEmailApiKey; workspaceName: string } | null> {
  const header = req.headers.get("authorization") ?? "";
  const key = (header.toLowerCase().startsWith("bearer ") ? header.slice(7) : req.headers.get("x-api-key") ?? "").trim();
  const ws = key.split("_")[1];
  if (!key.startsWith("emlk_") || !ws || !/^[a-f0-9]{24}$/i.test(ws)) return null;
  await connectToDatabase();
  const found = await EmailApiKey.findOne({ hash: hashOf(key), workspaceId: ws, revokedAt: null }).lean();
  if (!found) return null;
  const w = await Workspace.findById(ws).select("name status panels").lean();
  if (!w || (w.status ?? "active") !== "active" || !(w.panels ?? []).includes("email")) return null;
  await EmailApiKey.updateOne({ _id: found._id }, { lastUsedAt: new Date() });
  return { key: found, workspaceName: w.name };
}
