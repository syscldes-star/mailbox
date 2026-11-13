import { NextRequest } from "next/server";
import { connectToDatabase } from "@/lib/db/mongodb";
import { apiError, apiSuccess } from "@/lib/api/response";
import { newEmailKey, requireIntegrationsAdmin } from "@/lib/integrations/guard";
import { EmailApiKey } from "@/lib/integrations/models";

/** GET /api/integrations/keys -- this panel's API keys (not the keys). */
export async function GET() {
  const auth = await requireIntegrationsAdmin();
  if (!auth) return apiError("Only the workspace owner and admins can set up integrations.", 403);
  await connectToDatabase();
  const keys = await EmailApiKey.find({ workspaceId: auth.workspaceId }).sort({ revokedAt: 1, createdAt: -1 }).lean();
  return apiSuccess(keys.map((k) => ({ id: String(k._id), name: k.name, hint: k.hint, createdAt: k.createdAt, lastUsedAt: k.lastUsedAt, revoked: !!k.revokedAt })));
}

/** POST /api/integrations/keys {name} -- a new key (read only), shown once. */
export async function POST(req: NextRequest) {
  const auth = await requireIntegrationsAdmin();
  if (!auth) return apiError("Only the workspace owner and admins can set up integrations.", 403);
  const body = (await req.json().catch(() => null)) as { name?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 60) : "";
  if (!name) return apiError("Name the key (e.g. CRM).");
  await connectToDatabase();
  if ((await EmailApiKey.countDocuments({ workspaceId: auth.workspaceId, revokedAt: null })) >= 20) return apiError("Up to 20 keys: turn off one you don't use.");
  const { key, hash, hint } = newEmailKey(auth.workspaceId);
  await EmailApiKey.create({ workspaceId: auth.workspaceId, name, hash, hint, createdBy: auth.userId });
  return apiSuccess({ key }, "Copy the key now: it won't be shown again.", 201);
}
