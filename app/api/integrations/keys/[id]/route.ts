import { connectToDatabase } from "@/lib/db/mongodb";
import { apiError, apiSuccess } from "@/lib/api/response";
import { requireIntegrationsAdmin } from "@/lib/integrations/guard";
import { EmailApiKey } from "@/lib/integrations/models";

/** DELETE /api/integrations/keys/:id -- turns the key off for good. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireIntegrationsAdmin();
  if (!auth) return apiError("Only the workspace owner and admins can set up integrations.", 403);
  const { id } = await params;
  if (!/^[a-f0-9]{24}$/i.test(id)) return apiError("Key not found.", 404);
  await connectToDatabase();
  const r = await EmailApiKey.updateOne({ _id: id, workspaceId: auth.workspaceId, revokedAt: null }, { revokedAt: new Date() });
  if (!r.matchedCount) return apiError("Key not found.", 404);
  return apiSuccess(null, "Key turned off.");
}
