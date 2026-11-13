import { NextRequest } from "next/server";
import { connectToDatabase } from "@/lib/db/mongodb";
import { apiError, apiSuccess } from "@/lib/api/response";
import { requireIntegrationsAdmin } from "@/lib/integrations/guard";
import { CrmLink } from "@/lib/integrations/models";
import { importCrmLeads } from "@/lib/integrations/crm";

/** POST /api/integrations/crm/import {listName, status?, stage?, tag?,
 * source?, q?} -- a new contact list of the CRM leads (with an email)
 * that match, up to 5,000. */
export async function POST(req: NextRequest) {
  const auth = await requireIntegrationsAdmin();
  if (!auth) return apiError("Only the workspace owner and admins can set up integrations.", 403);
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const listName = typeof body?.listName === "string" ? body.listName.trim().slice(0, 100) : "";
  if (!listName) return apiError("Name the new list.");
  const pick = (k: string) => (typeof body?.[k] === "string" ? (body[k] as string).slice(0, 100) : undefined);
  await connectToDatabase();
  const link = await CrmLink.findOne({ workspaceId: auth.workspaceId }).lean();
  if (!link) return apiError("Link the CRM first.", 400);
  try {
    const r = await importCrmLeads(link, { workspaceId: auth.workspaceId, createdBy: auth.userId, listName, filter: { status: pick("status"), stage: pick("stage"), tag: pick("tag"), source: pick("source"), q: pick("q") } });
    return apiSuccess(r, `List “${listName}” made with ${r.contacts} contacts.`, 201);
  } catch (e) {
    return apiError(`Couldn't read the CRM: ${(e as Error).message}`, 502);
  }
}
