// lib/models/SyncState.ts
//
// Small key/value store for background-task cursors, e.g. how far the
// bounce/complaint sync has read Oracle's suppression list.

import { Schema, type Model } from "mongoose";
import { emailDb } from "../db/mongodb";

export interface ISyncState {
  _id: string;
  at: Date;
}

const SyncStateSchema = new Schema<ISyncState>({ _id: { type: String, required: true }, at: { type: Date, required: true } });

const db = emailDb();
export const SyncState: Model<ISyncState> =
  (db.models.SyncState as Model<ISyncState> | undefined) ?? db.model<ISyncState>("SyncState", SyncStateSchema);
