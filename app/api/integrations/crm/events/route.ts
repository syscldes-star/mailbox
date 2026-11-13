import { connectToDatabase } from "@/lib/db/mongodb";
import { apiError, apiSuccess } from "@/lib/api/response";
import { requireIntegrationsAdmin } from "@/lib/integrations/guard";
import { CrmEvent } from "@/lib/integrations/models";

/** GET /api/integrations/crm/events -- the last 50 signups, opens and
 * clicks written to (or waiting for) the CRM, newest first. */
export async function GET() {
  const auth = await requireIntegrationsAdmin();
  if (!auth) return apiError("Only the workspace owner and admins can set up integrations.", 403);
  await connectToDatabase();
  const list = await CrmEvent.find({ workspaceId: auth.workspaceId }).sort({ createdAt: -1 }).limit(50).lean();
  return apiSuccess(list.map((e) => ({ id: String(e._id), kind: e.kind, email: e.email, detail: e.detail, status: e.status, result: e.result, attempts: e.attempts, at: e.createdAt })));
}
