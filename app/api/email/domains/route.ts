// app/api/email/domains/route.ts
//
// Session-cookie protected (requireAuth), NOT the internal-secret path --
// this is what the /email/domains dashboard page itself calls from the
// browser, same pattern as the website-builder app's own /api routes.

import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { requireAuth } from "@/lib/api/requireAuth";
import { apiSuccess, apiError } from "@/lib/api/response";
import { provisionDomainEmail } from "@/lib/email-provisioning/provision-domain";
import { assertDomainOwnedByWorkspace } from "@/lib/email-provisioning/domain-ownership";
import {
  loadState,
  saveState,
  loadStatesForWorkspace,
  markPasswordRevealed,
} from "@/lib/email-provisioning/state-store";

export async function GET() {
  const auth = await requireAuth();
  if (!auth) return apiError("Not authenticated.", 401);

  const states = await loadStatesForWorkspace(auth.workspaceId);

  const result = await Promise.all(
    states.map(async ({ defaultMailboxPassword, defaultMailboxPasswordRevealed, ...rest }) => {
      // Reveal the password exactly once -- the first time we see the
      // mailbox actually finished, regardless of how many retries it
      // took to get there. After this, it's stripped from every future
      // response, same as an API key shown only at creation time.
      const justCompleted = rest.steps.mailcow_mailbox === "done" && !defaultMailboxPasswordRevealed;
      if (justCompleted) {
        await markPasswordRevealed(rest.domain);
        return { ...rest, defaultMailboxPassword };
      }
      return rest;
    })
  );

  return apiSuccess(result);
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (!auth) return apiError("Not authenticated.", 401);

  const { domain, defaultMailboxLocalPart } = await req.json();
  if (!domain || !defaultMailboxLocalPart) {
    return apiError("domain and defaultMailboxLocalPart are required.", 400);
  }

  const ownership = await assertDomainOwnedByWorkspace(domain, auth.workspaceId);
  if (!ownership.allowed) {
    return apiError(ownership.reason, 403);
  }

  const defaultMailboxPassword = crypto.randomUUID().replace(/-/g, "").slice(0, 20);

  waitUntil(
    provisionDomainEmail(
      domain,
      auth.workspaceId,
      defaultMailboxLocalPart,
      defaultMailboxPassword,
      loadState,
      saveState
    )
  );

  return apiSuccess({ status: "provisioning_started", domain });
}
