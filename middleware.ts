// middleware.ts
//
// Only the server-to-server provisioning routes need the shared-secret
// check -- those are called by `frontend`/`site` directly, with no user
// browser session involved. Everything else (/api/auth/*, /api/email/*,
// and the actual pages) uses the normal shared session cookie via
// requireAuth() in each route/page, same as `site` does.

import { NextRequest, NextResponse } from "next/server";

export function middleware(req: NextRequest) {
  const secret = req.headers.get("x-internal-secret");
  if (secret !== process.env.EMAIL_SERVICE_INTERNAL_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/api/provision", "/api/provision-status"],
};
