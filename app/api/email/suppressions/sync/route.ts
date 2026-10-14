// app/api/email/suppressions/sync/route.ts
//
// Session-cookie protected. Runs the bounce/complaint sync now instead of
// waiting for the scheduler's next 15-minute run.

import { requireAuth, hasMinimumRole } from "@/lib/api/requireAuth";
import { apiSuccess, apiError } from "@/lib/api/response";
import { syncBounces } from "@/lib/bulk-email/bounces";
import { MIN_SEND_ROLE } from "@/lib/bulk-email/access";

export async function POST() {
  const auth = await requireAuth();
  if (!auth) return apiError("Not authenticated.", 401);
  if (!hasMinimumRole(auth.membership.role, MIN_SEND_ROLE)) {
    return apiError("Only managers, admins, and owners can run the bounce check.", 403);
  }
  try {
    const result = await syncBounces();
    return apiSuccess(result, "Bounce check finished.");
  } catch (err) {
    return apiError(`Bounce check failed: ${err instanceof Error ? err.message : String(err)}`, 502);
  }
}
