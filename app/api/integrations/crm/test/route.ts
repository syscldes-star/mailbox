import { connectToDatabase } from "@/lib/db/mongodb";
import { apiError, apiSuccess } from "@/lib/api/response";
import { requireIntegrationsAdmin } from "@/lib/integrations/guard";
import { CrmLink } from "@/lib/integrations/models";
import { testCrm } from "@/lib/integrations/crm";

/** POST /api/integrations/crm/test -- checks the CRM link again. */
export async function POST() {
  const auth = await requireIntegrationsAdmin();
  if (!auth) return apiError("Only the workspace owner and admins can set up integrations.", 403);
  await connectToDatabase();
  const link = await CrmLink.findOne({ workspaceId: auth.workspaceId }).lean();
  if (!link) return apiError("The CRM isn't linked yet.", 404);
  return apiSuccess(await testCrm(link));
}
