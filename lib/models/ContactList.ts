// lib/models/ContactList.ts
//
// Saved recipient lists. Contacts are embedded (capped at
// MAX_CONTACTS_PER_LIST) with their extra CSV columns kept in `vars`, so
// a list can be loaded into Compose and filtered into segments, e.g.
// "city = Delhi".

import { Schema, type Document, type Model } from "mongoose";
import { emailDb } from "../db/mongodb";

export const MAX_CONTACTS_PER_LIST = 20000;

export interface IContact {
  email: string;
  name?: string;
  vars?: Record<string, string>;
}

export interface IContactList extends Document {
  workspaceId: string;
  name: string;
  /** Column names available as merge tags / segment filters. */
  columns: string[];
  contacts: IContact[];
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const ContactSchema = new Schema<IContact>(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    name: String,
    vars: { type: Schema.Types.Mixed },
  },
  { _id: false }
);

const ContactListSchema = new Schema<IContactList>(
  {
    workspaceId: { type: String, required: true, index: true },
    name: { type: String, required: true, trim: true },
    columns: { type: [String], default: ["email", "name"] },
    contacts: { type: [ContactSchema], default: [] },
    createdBy: { type: String, required: true },
  },
  { timestamps: true }
);

const db = emailDb();
export const ContactList: Model<IContactList> =
  (db.models.ContactList as Model<IContactList> | undefined) ?? db.model<IContactList>("ContactList", ContactListSchema);
