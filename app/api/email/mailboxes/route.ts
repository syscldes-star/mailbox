// app/api/email/mailboxes/route.ts
//
// Session-cookie protected. GET ?domain=x lists mailboxes; POST creates
// an additional mailbox on a domain that's already been provisioned
// (i.e. already has a row in EmailProvisioning for this workspace).

import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api/requireAuth";
import { apiSuccess, apiError } from "@/lib/api/response";
import {
  mailcowListMailboxes,
  mailcowAddMailbox,
  mailcowEditMailboxName,
  mailcowDeleteMailbox,
  mailcowResetMailboxPassword,
  mailcowSetRecoveryEmail,
} from "@/lib/email-provisioning/mailcow-client";
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

/** Update an existing mailbox's display name and/or recovery email --
 * lets the owner set these themselves without needing Mailcow admin
 * access. The recovery email is what Mailcow's own self-service
 * "Forgot Password" page (mail.<domain>/reset-password) sends the reset
 * link to -- it's required for that flow to do anything at all. */
export async function PATCH(req: NextRequest) {
  const auth = await requireAuth();
  if (!auth) return apiError("Not authenticated.", 401);

  const { domain, username, name, recoveryEmail } = await req.json();
  if (!domain || !username) {
    return apiError("domain and username are required.", 400);
  }
  if (name === undefined && recoveryEmail === undefined) {
    return apiError("Provide name and/or recoveryEmail to update.", 400);
  }
  if (recoveryEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recoveryEmail)) {
    return apiError("recoveryEmail must be a valid email address.", 400);
  }

  if (!(await assertWorkspaceOwnsDomain(domain, auth.workspaceId))) {
    return apiError("Domain not found for this workspace.", 404);
  }

  let result: unknown = null;
  if (name !== undefined) {
    result = await mailcowEditMailboxName(username, name ?? "");
  }
  if (recoveryEmail !== undefined) {
    result = await mailcowSetRecoveryEmail(username, recoveryEmail ?? "");
  }
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

/** Resets a mailbox's password to a freshly generated one and returns it
 * once. There's no self-service "forgot password" flow yet, so this is
 * the admin-triggered path: the password is generated server-side (never
 * accepted from the client) and is not persisted anywhere -- the caller
 * must copy it from this response, same as the one-time reveal at
 * provisioning time. */
export async function PUT(req: NextRequest) {
  const auth = await requireAuth();
  if (!auth) return apiError("Not authenticated.", 401);

  const { domain, username } = await req.json();
  if (!domain || !username) {
    return apiError("domain and username are required.", 400);
  }

  if (!(await assertWorkspaceOwnsDomain(domain, auth.workspaceId))) {
    return apiError("Domain not found for this workspace.", 404);
  }

  const password = await mailcowResetMailboxPassword(username);
  return apiSuccess({ username, password });
}
