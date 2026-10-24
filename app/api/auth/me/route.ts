import { checkSession } from "@/lib/api/requireAuth";
import { apiSuccess, apiError } from "@/lib/api/response";

export async function GET() {
  const result = await checkSession();
  if (!result.ok) {
    // 403 = signed in but can't use this app -> the client sends them
    // back to main, which shows where they belong.
    return result.reason === "no_access"
      ? apiError("You don't have access to the email app.", 403)
      : apiError("Not authenticated.", 401);
  }
  const { auth } = result;

  return apiSuccess({
    user: {
      id: auth.user._id.toString(),
      email: auth.user.email,
      firstName: auth.user.firstName,
      lastName: auth.user.lastName,
      avatarUrl: auth.user.avatarUrl ?? null,
    },
    workspace: { id: auth.workspaceId, name: auth.workspace?.name ?? null },
    role: auth.membership.role,
  });
}
