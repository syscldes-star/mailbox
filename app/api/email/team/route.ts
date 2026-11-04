import { requireAuth } from "@/lib/api/requireAuth";
import { apiSuccess, apiError } from "@/lib/api/response";
import { isOwner, shareableMembers } from "@/lib/visibility";

/** Team members the owner can share campaigns, templates, lists and
 * forms with (owner only). */
export async function GET() {
  const auth = await requireAuth();
  if (!auth) return apiError("Not authenticated.", 401);
  if (!isOwner(auth)) return apiError("Only the workspace owner can share.", 403);
  return apiSuccess(await shareableMembers(auth.workspaceId));
}
