// app/api/integrations/crm/route.ts
//
// The workspace's CRM link (Integrations → CRM). The owner and admins.

import { NextRequest } from "next/server";
import { connectToDatabase } from "@/lib/db/mongodb";
import { apiError, apiSuccess } from "@/lib/api/response";
import { requireIntegrationsAdmin } from "@/lib/integrations/guard";
import { CrmLink, type ICrmLink } from "@/lib/integrations/models";
import { cleanCrmUrl, testCrm } from "@/lib/integrations/crm";
import { encryptSecret } from "@/lib/integrations/secret";
import { SignupForm } from "@/lib/models/SignupForm";

const NOT_ALLOWED = "Only the workspace owner and admins can set up integrations.";

const view = (l: ICrmLink | null) =>
  l
    ? { baseUrl: l.baseUrl, keyHint: l.keyHint, status: l.status, lastCheckedAt: l.lastCheckedAt, lastError: l.lastError, crmWorkspace: l.crmWorkspace, signupLeads: l.signupLeads, offForms: l.offForms, engagementNotes: l.engagementNotes }
    : null;

/** GET -- the link (not its key) and the workspace's signup forms. */
export async function GET() {
  const auth = await requireIntegrationsAdmin();
  if (!auth) return apiError(NOT_ALLOWED, 403);
  await connectToDatabase();
  const [link, forms] = await Promise.all([CrmLink.findOne({ workspaceId: auth.workspaceId }).lean(), SignupForm.find({ workspaceId: auth.workspaceId }).select("name active signups").sort({ name: 1 }).lean()]);
  return apiSuccess({ link: view(link), forms: forms.map((f) => ({ id: String(f._id), name: f.name, active: f.active, signups: f.signups })) });
}

/** PUT {baseUrl, key} -- links (or re-links) the CRM with a key made there
 * (Read & write), and checks it. */
export async function PUT(req: NextRequest) {
  const auth = await requireIntegrationsAdmin();
  if (!auth) return apiError(NOT_ALLOWED, 403);
  const body = (await req.json().catch(() => null)) as { baseUrl?: unknown; key?: unknown } | null;
  const u = cleanCrmUrl(typeof body?.baseUrl === "string" ? body.baseUrl : "");
  if ("error" in u) return apiError(u.error);
  const key = typeof body?.key === "string" ? body.key.trim() : "";
  if (!/^crmk_\w+_[\w-]+$/.test(key)) return apiError("Paste the CRM API key (it starts with crmk_). Make one in the CRM: Settings → API & Integrations.");
  await connectToDatabase();
  await CrmLink.updateOne(
    { workspaceId: auth.workspaceId },
    { $set: { baseUrl: u.url, keyEnc: encryptSecret(key), keyHint: key.slice(-4), status: "failed", lastError: "", createdBy: auth.userId } },
    { upsert: true }
  );
  const test = await testCrm((await CrmLink.findOne({ workspaceId: auth.workspaceId }).lean())!);
  return apiSuccess({ link: view(await CrmLink.findOne({ workspaceId: auth.workspaceId }).lean()), test });
}

/** PATCH {signupLeads?, engagementNotes?, offForms?} */
export async function PATCH(req: NextRequest) {
  const auth = await requireIntegrationsAdmin();
  if (!auth) return apiError(NOT_ALLOWED, 403);
  const body = (await req.json().catch(() => null)) as { signupLeads?: unknown; engagementNotes?: unknown; offForms?: unknown } | null;
  const set: Record<string, unknown> = {};
  if (typeof body?.signupLeads === "boolean") set.signupLeads = body.signupLeads;
  if (typeof body?.engagementNotes === "boolean") set.engagementNotes = body.engagementNotes;
  if (Array.isArray(body?.offForms)) set.offForms = body.offForms.filter((x): x is string => typeof x === "string" && /^[a-f0-9]{24}$/i.test(x)).slice(0, 500);
  if (Object.keys(set).length === 0) return apiError("Nothing to change.");
  await connectToDatabase();
  const link = await CrmLink.findOneAndUpdate({ workspaceId: auth.workspaceId }, { $set: set }, { new: true }).lean();
  if (!link) return apiError("Link the CRM first.", 404);
  return apiSuccess({ link: view(link) });
}

/** DELETE -- unlinks the CRM (its key is forgotten). */
export async function DELETE() {
  const auth = await requireIntegrationsAdmin();
  if (!auth) return apiError(NOT_ALLOWED, 403);
  await connectToDatabase();
  await CrmLink.deleteOne({ workspaceId: auth.workspaceId });
  return apiSuccess(null, "The CRM is unlinked.");
}
