// app/api/provision-status/route.ts
//
// Server-to-server route, protected by middleware.ts's internal-secret
// check. GET /api/provision-status?domain=customerdomain.com
// `frontend` can poll this too, but the browser-facing equivalent for
// this app's own UI is GET /api/email/domains (session-cookie protected).

import { NextRequest, NextResponse } from "next/server";
import { loadState } from "@/lib/email-provisioning/state-store";

export async function GET(req: NextRequest) {
  const domain = req.nextUrl.searchParams.get("domain");
  if (!domain) {
    return NextResponse.json({ error: "domain query param required" }, { status: 400 });
  }
  const state = await loadState(domain);
  if (!state) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json(state);
}
