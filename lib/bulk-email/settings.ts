// lib/bulk-email/settings.ts
//
// Workspace Bulk Email settings.

import { EmailSettings } from "../models/EmailSettings";

export interface WorkspaceEmailSettings {
  postalAddress: string;
}

export async function getEmailSettings(workspaceId: string): Promise<WorkspaceEmailSettings> {
  const doc = await EmailSettings.findOne({ workspaceId }).lean();
  return { postalAddress: doc?.postalAddress ?? "" };
}
