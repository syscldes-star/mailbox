// lib/models/Workspace.ts
//
// Read-only copy of main's Workspace model (same collection). This app
// only reads it to check the workspace is active and has the Email panel.

import mongoose, { Schema, type Document, type Model } from "mongoose";

export interface IWorkspace extends Document {
  name: string;
  ownerId: mongoose.Types.ObjectId;
  /** pending (awaiting the platform admin), active or suspended. Missing
   * on older workspaces, which counts as active. */
  status?: "pending" | "active" | "suspended";
  /** Panels the platform admin gave this workspace. */
  panels?: string[];
  createdAt: Date;
  updatedAt: Date;
}

const WorkspaceSchema = new Schema<IWorkspace>(
  {
    name: { type: String, required: true, trim: true },
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    status: { type: String },
    panels: { type: [String], default: undefined },
  },
  { timestamps: true }
);

export const Workspace: Model<IWorkspace> =
  mongoose.models.Workspace ?? mongoose.model<IWorkspace>("Workspace", WorkspaceSchema);
