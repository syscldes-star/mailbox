// app/api/email/drafts/route.ts
//
// Session-cookie protected. POST saves a new draft from Compose
// (optionally inside a campaign).

import { NextRequest } from "next/server";
import { requireAuth, hasMinimumRole } from "@/lib/api/requireAuth";
import { apiSuccess, apiError } from "@/lib/api/response";
import { EmailDraft } from "@/lib/models/EmailDraft";
import { cleanDraftInput, type DraftInput } from "@/lib/bulk-email/drafts";
import { MIN_SEND_ROLE } from "@/lib/bulk-email/access";

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (!auth) return apiError("Not authenticated.", 401);
  if (!hasMinimumRole(auth.membership.role, MIN_SEND_ROLE)) {
    return apiError("Only managers, admins, and owners can save drafts.", 403);
  }
  const result = await cleanDraftInput(auth.workspaceId, (await req.json()) as DraftInput);
  if ("error" in result) return apiError(result.error!, 400);

  const draft = await EmailDraft.create({ ...result.value, workspaceId: auth.workspaceId, createdBy: auth.userId });
  return apiSuccess({ id: String(draft._id), updatedAt: draft.updatedAt }, "Draft saved.", 201);
}
