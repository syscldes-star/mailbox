// app/api/provision/route.ts
//
// Server-to-server route, protected by middleware.ts's internal-secret
// check. Call this from `frontend` (or `site`, wherever domain
// verification happens) the moment a customer's domain is verified.
// Runs the pipeline in the background and responds immediately.

import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { provisionDomainEmail } from "@/lib/email-provisioning/provision-domain";
import { loadState, saveState } from "@/lib/email-provisioning/state-store";

export async function POST(req: NextRequest) {
  const { domain, customerId, defaultMailboxLocalPart } = await req.json();

  if (!domain || !customerId || !defaultMailboxLocalPart) {
    return NextResponse.json(
      { error: "domain, customerId, and defaultMailboxLocalPart are required" },
      { status: 400 }
    );
  }

  const defaultMailboxPassword = crypto.randomUUID().replace(/-/g, "").slice(0, 20);

  waitUntil(
    provisionDomainEmail(
      domain,
      customerId,
      defaultMailboxLocalPart,
      defaultMailboxPassword,
      loadState,
      saveState
    )
  );

  return NextResponse.json({ status: "provisioning_started", domain });
}
