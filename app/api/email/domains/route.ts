// app/api/email/domains/route.ts
//
// Session-cookie protected (requireAuth), NOT the internal-secret path --
// this is what the /email/domains dashboard page itself calls from the
// browser, same pattern as the website-builder app's own /api routes.

import { NextRequest } from "next/server";
import { waitUntil } from "@vercel/functions";
import { requireAuth } from "@/lib/api/requireAuth";
import { logWork } from "@/lib/activity";
import { apiSuccess, apiError } from "@/lib/api/response";
import { provisionDomainEmail } from "@/lib/email-provisioning/provision-domain";
import { randomBytes } from "crypto";
import { assertDomainOwnedByWorkspace } from "@/lib/email-provisioning/domain-ownership";
import { initialProvisioningState } from "@/lib/email-provisioning/types";
import { LOCAL_PART_PATTERN } from "@/lib/bulk-email/access";
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

const DOMAIN_PATTERN = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (!auth) return apiError("Not authenticated.", 401);

  const body = await req.json();
  const domain = String(body.domain ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
  const defaultMailboxLocalPart = String(body.defaultMailboxLocalPart ?? "").trim().toLowerCase();
  if (!domain || !defaultMailboxLocalPart) {
    return apiError("domain and defaultMailboxLocalPart are required.", 400);
  }
  if (!DOMAIN_PATTERN.test(domain)) return apiError("That doesn't look like a domain name (e.g. example.com).", 400);
  if (!LOCAL_PART_PATTERN.test(defaultMailboxLocalPart)) return apiError("The mailbox name can only use letters, numbers and . _ - +", 400);

  const existing = await loadState(domain);
  if (existing && existing.customerId !== auth.workspaceId) {
    return apiError(`${domain} is already set up by another account.`, 409);
  }
  if (existing) return apiError(`${domain} is already added -- see it below.`, 409);

  // A site's verified custom domain (DNS on Vercel) is set up automatically.
  // Any other domain -- e.g. a webmail-only customer with no site on the
  // platform -- uses manual DNS: they add the records we show, starting
  // with a TXT record proving they control the domain.
  const ownership = await assertDomainOwnedByWorkspace(domain, auth.workspaceId);
  let dnsMode: "vercel" | "manual" = "vercel";
  if (!ownership.allowed) {
    // A domain attached to someone else's site, or a site domain still
    // verifying, isn't up for grabs through manual DNS.
    if (ownership.code !== "not_connected") return apiError(ownership.reason, 403);
    dnsMode = "manual";
  }

  const defaultMailboxPassword = crypto.randomUUID().replace(/-/g, "").slice(0, 20);
  if (dnsMode === "manual") {
    await saveState(
      initialProvisioningState(domain, auth.workspaceId, defaultMailboxLocalPart, defaultMailboxPassword, "manual", randomBytes(12).toString("hex"))
    );
  }

  waitUntil(provisionDomainEmail(domain, auth.workspaceId, defaultMailboxLocalPart, defaultMailboxPassword, loadState, saveState));

  await logWork(auth, "email_domain_added", domain);

  return apiSuccess({ status: dnsMode === "manual" ? "add_dns_records" : "provisioning_started", domain, dnsMode });
}
