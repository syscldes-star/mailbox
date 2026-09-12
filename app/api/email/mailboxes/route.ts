// app/api/email/mailboxes/route.ts
//
// Session-cookie protected. GET ?domain=x lists mailboxes; POST creates
// an additional mailbox on a domain that's already been provisioned
// (i.e. already has a row in EmailProvisioning for this workspace).

import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api/requireAuth";
import { apiSuccess, apiError } from "@/lib/api/response";
import { mailcowListMailboxes, mailcowAddMailbox, mailcowEditMailboxName, mailcowDeleteMailbox } from "@/lib/email-provisioning/mailcow-client";
import { loadState } from "@/lib/email-provisioning/state-store";

/** Confirms the domain actually belongs to this workspace before touching
 * Mailcow on its behalf -- without this, any logged-in user could list or
 * create mailboxes on any domain by guessing it in the query string. */
async function assertWorkspaceOwnsDomain(domain: string, workspaceId: string) {
  const state = await loadState(domain);
  return state?.customerId === workspaceId;
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (!auth) return apiError("Not authenticated.", 401);

  const domain = req.nextUrl.searchParams.get("domain");
  if (!domain) return apiError("domain query param required.", 400);

  if (!(await assertWorkspaceOwnsDomain(domain, auth.workspaceId))) {
    return apiError("Domain not found for this workspace.", 404);
  }

  const mailboxes = await mailcowListMailboxes(domain);
  return apiSuccess(mailboxes);
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (!auth) return apiError("Not authenticated.", 401);

  const { domain, localPart, password, fullName } = await req.json();
  if (!domain || !localPart || !password) {
    return apiError("domain, localPart, and password are required.", 400);
  }

  if (!(await assertWorkspaceOwnsDomain(domain, auth.workspaceId))) {
    return apiError("Domain not found for this workspace.", 404);
  }

  const result = await mailcowAddMailbox({
    domain,
    localPart,
    password,
    fullName: fullName || `${localPart}@${domain}`,
  });
  return apiSuccess(result);
}

/** Update an existing mailbox's display name -- lets the owner set this
 * themselves without needing Mailcow admin access. */
export async function PATCH(req: NextRequest) {
  const auth = await requireAuth();
  if (!auth) return apiError("Not authenticated.", 401);

  const { domain, username, name } = await req.json();
  if (!domain || !username) {
    return apiError("domain and username are required.", 400);
  }

  if (!(await assertWorkspaceOwnsDomain(domain, auth.workspaceId))) {
    return apiError("Domain not found for this workspace.", 404);
  }

  const result = await mailcowEditMailboxName(username, name ?? "");
  return apiSuccess(result);
}

/** Permanently deletes a mailbox. */
export async function DELETE(req: NextRequest) {
  const auth = await requireAuth();
  if (!auth) return apiError("Not authenticated.", 401);

  const domain = req.nextUrl.searchParams.get("domain");
  const username = req.nextUrl.searchParams.get("username");
  if (!domain || !username) {
    return apiError("domain and username query params are required.", 400);
  }

  if (!(await assertWorkspaceOwnsDomain(domain, auth.workspaceId))) {
    return apiError("Domain not found for this workspace.", 404);
  }

  const result = await mailcowDeleteMailbox(username);
  return apiSuccess(result);
}
