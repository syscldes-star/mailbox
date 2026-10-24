import mongoose, { Schema } from "mongoose";
import type { AuthContext } from "@/lib/api/requireAuth";

// Writes into main's activity log (the shared `activitylogs` collection
// on the platform database), so the workspace owner and the platform
// admin can see who is doing what. Main owns the format and the labels
// (constants/activity.ts there) -- keep the action names in step.

export type WorkAction =
  | "email_campaign_created"
  | "email_campaign_started"
  | "email_template_saved"
  | "email_domain_added"
  | "email_mailbox_created"
  | "email_shared";

const ActivityLogSchema = new Schema(
  {
    workspaceId: Schema.Types.ObjectId,
    action: String,
    actorUserId: Schema.Types.ObjectId,
    actorName: String,
    actorEmail: String,
    details: String,
    createdAt: { type: Date, default: Date.now },
  },
  // Main created the collection and its 180-day expiry index.
  { collection: "activitylogs", autoIndex: false }
);

const ActivityLog = mongoose.models.ActivityLog ?? mongoose.model("ActivityLog", ActivityLogSchema);

/** Records work for the activity log. Never throws -- a logging problem
 * must not break the action it's recording. */
export async function logWork(auth: AuthContext, action: WorkAction, details: string): Promise<void> {
  try {
    await ActivityLog.create({
      workspaceId: new mongoose.Types.ObjectId(auth.workspaceId),
      action,
      actorUserId: auth.user._id,
      actorName: `${auth.user.firstName} ${auth.user.lastName}`.trim(),
      actorEmail: auth.user.email,
      details,
    });
  } catch (err) {
    console.error("Couldn't write activity log entry:", err);
  }
}
