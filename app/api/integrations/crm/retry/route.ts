import { apiError, apiSuccess } from "@/lib/api/response";
import { requireIntegrationsAdmin } from "@/lib/integrations/guard";
import { CrmEvent } from "@/lib/integrations/models";
import { runCrmQueue } from "@/lib/integrations/crm";

/** POST /api/integrations/crm/retry -- sends what's waiting now, without
 * waiting for its next try. */
export async function POST() {
  const auth = await requireIntegrationsAdmin();
  if (!auth) return apiError("Only the workspace owner and admins can set up integrations.", 403);
  await CrmEvent.updateMany({ workspaceId: auth.workspaceId, status: "pending" }, { $set: { nextAt: new Date() } });
  const sent = await runCrmQueue(auth.workspaceId);
  return apiSuccess({ sent });
}
