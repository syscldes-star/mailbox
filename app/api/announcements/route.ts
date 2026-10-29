import { APP_PANEL, requireAuth } from "@/lib/api/requireAuth";
import { apiSuccess, apiError } from "@/lib/api/response";
import { bannersFor } from "@/lib/platform";

/** The platform admin's banners for the signed-in person (written in
 * main's Admin Panel). */
export async function GET() {
  const auth = await requireAuth();
  if (!auth) return apiError("Not authenticated.", 401);
  return apiSuccess(await bannersFor(auth, APP_PANEL));
}
