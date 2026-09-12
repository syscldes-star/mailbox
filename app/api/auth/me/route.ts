import { requireAuth } from "@/lib/api/requireAuth";
import { apiSuccess, apiError } from "@/lib/api/response";

// This service doesn't have the Workspace model (main/site own that
// data) -- returning just the id is enough to key provisioning records
// and mailbox ownership. If the UI ever needs to show the workspace's
// display name, add Workspace as a lean read-only model here too, same
// way User/WorkspaceMember were copied over.

export async function GET() {
  const auth = await requireAuth();
  if (!auth) return apiError("Not authenticated.", 401);

  return apiSuccess({
    user: {
      id: auth.user._id.toString(),
      email: auth.user.email,
      firstName: auth.user.firstName,
      lastName: auth.user.lastName,
      avatarUrl: auth.user.avatarUrl ?? null,
    },
    workspace: { id: auth.workspaceId },
    role: auth.membership.role,
  });
}
