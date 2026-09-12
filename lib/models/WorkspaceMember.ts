import mongoose, { Schema, type Document, type Model } from "mongoose";

/**
 * A core role set shared across the whole platform. Individual modules in
 * the PRD sometimes name roles more specifically ("Website Manager",
 * "SEO Manager", "Designer") -- those read as finer-grained capabilities
 * layered on top of this core set, not a replacement for it. Modeling
 * that full capability system is future work; this foundation covers the
 * role every permission table in the PRD reduces to at its core.
 */
export type WorkspaceRole = "owner" | "admin" | "manager" | "staff" | "readonly";

export const WORKSPACE_ROLES: WorkspaceRole[] = ["owner", "admin", "manager", "staff", "readonly"];

export interface IWorkspaceMember extends Document {
  workspaceId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  role: WorkspaceRole;
  invitedBy?: mongoose.Types.ObjectId;
  joinedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const WorkspaceMemberSchema = new Schema<IWorkspaceMember>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: "Workspace", required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    role: { type: String, enum: WORKSPACE_ROLES, required: true, default: "staff" },
    invitedBy: { type: Schema.Types.ObjectId, ref: "User" },
    joinedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// A user can only have one membership record per workspace.
WorkspaceMemberSchema.index({ workspaceId: 1, userId: 1 }, { unique: true });

export const WorkspaceMember: Model<IWorkspaceMember> =
  mongoose.models.WorkspaceMember ??
  mongoose.model<IWorkspaceMember>("WorkspaceMember", WorkspaceMemberSchema);