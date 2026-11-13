import { NextRequest, NextResponse } from "next/server";
import { emailKeyAuth } from "@/lib/integrations/guard";

/** GET /api/v1/me -- who this key is (for another app's "test the link",
 * e.g. the CRM's Connected apps). Same shape as every panel's. */
export async function GET(req: NextRequest) {
  const k = await emailKeyAuth(req);
  if (!k) return NextResponse.json({ error: "Invalid API key." }, { status: 401 });
  return NextResponse.json({ app: "email", workspace: { id: k.key.workspaceId, name: k.workspaceName }, key: { name: k.key.name, scope: "read" } });
}
