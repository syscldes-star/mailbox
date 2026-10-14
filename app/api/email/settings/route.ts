// app/api/email/settings/route.ts
//
// Session-cookie protected. GET returns the workspace's Bulk Email
// settings; PUT updates them (admins and owners only).

import { NextRequest } from "next/server";
import { requireAuth, hasMinimumRole } from "@/lib/api/requireAuth";
import { apiSuccess, apiError } from "@/lib/api/response";
import { EmailSettings } from "@/lib/models/EmailSettings";
import { getEmailSettings } from "@/lib/bulk-email/settings";

export async function GET() {
  const auth = await requireAuth();
  if (!auth) return apiError("Not authenticated.", 401);
  return apiSuccess({
    ...(await getEmailSettings(auth.workspaceId)),
    canEdit: hasMinimumRole(auth.membership.role, "admin"),
  });
}

export async function PUT(req: NextRequest) {
  const auth = await requireAuth();
  if (!auth) return apiError("Not authenticated.", 401);
  if (!hasMinimumRole(auth.membership.role, "admin")) {
    return apiError("Only admins and owners can change Bulk Email settings.", 403);
  }

  const { postalAddress } = await req.json();
  const update: Record<string, unknown> = {};

  if (postalAddress !== undefined) {
    const address = String(postalAddress ?? "").trim();
    if (address.length > 500) return apiError("Postal address is too long (500 characters max).", 400);
    update.postalAddress = address;
  }

  await EmailSettings.updateOne(
    { workspaceId: auth.workspaceId },
    { $set: update, $setOnInsert: { workspaceId: auth.workspaceId } },
    { upsert: true }
  );
  return apiSuccess(await getEmailSettings(auth.workspaceId), "Settings saved.");
}
