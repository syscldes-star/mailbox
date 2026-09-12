import { clearSessionCookie } from "@/lib/auth/session";
import { apiSuccess } from "@/lib/api/response";

export async function POST() {
  await clearSessionCookie();
  return apiSuccess(null, "Logged out successfully.");
}