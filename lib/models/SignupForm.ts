// lib/models/SignupForm.ts
//
// Public signup forms that add confirmed subscribers (double opt-in) to a
// saved contact list. Managed from Email Marketing → Signup forms; the
// public form lives at /api/subscribe/<id>.

import { Schema, type Document, type Model } from "mongoose";
import { emailDb } from "../db/mongodb";

export interface ISignupForm extends Document {
  workspaceId: string;
  name: string;
  listId: string;
  /** Sender of the confirmation email. */
  fromDomain: string;
  fromLocalPart: string;
  fromName?: string;
  heading: string;
  description?: string;
  buttonText: string;
  askName: boolean;
  /** Where to send people after they confirm (optional, http(s) only). */
  redirectUrl?: string;
  active: boolean;
  signups: number;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const SignupFormSchema = new Schema<ISignupForm>(
  {
    workspaceId: { type: String, required: true, index: true },
    name: { type: String, required: true, trim: true },
    listId: { type: String, required: true },
    fromDomain: { type: String, required: true, lowercase: true },
    fromLocalPart: { type: String, required: true, lowercase: true },
    fromName: String,
    heading: { type: String, required: true },
    description: String,
    buttonText: { type: String, default: "Subscribe" },
    askName: { type: Boolean, default: true },
    redirectUrl: String,
    active: { type: Boolean, default: true },
    signups: { type: Number, default: 0 },
    createdBy: { type: String, required: true },
  },
  { timestamps: true }
);

const db = emailDb();
export const SignupForm: Model<ISignupForm> =
  (db.models.SignupForm as Model<ISignupForm> | undefined) ?? db.model<ISignupForm>("SignupForm", SignupFormSchema);
