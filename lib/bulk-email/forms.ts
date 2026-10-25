// lib/bulk-email/forms.ts
//
// Validation shared by the signup-form create and update routes.

import mongoose from "mongoose";
import { ContactList } from "../models/ContactList";
import { LOCAL_PART_PATTERN, senderProblem } from "./access";

export interface FormInput {
  name?: string;
  listId?: string;
  fromDomain?: string;
  fromLocalPart?: string;
  fromName?: string;
  heading?: string;
  description?: string;
  buttonText?: string;
  askName?: boolean;
  redirectUrl?: string;
  active?: boolean;
}

/** Returns cleaned fields, or an error message. `partial` allows
 * updating only some fields. */
/** `listScope` limits which lists a form can point at (lib/visibility.ts
 * visibleTo); defaults to the whole workspace. */
export async function validateFormInput(
  workspaceId: string,
  input: FormInput,
  partial: boolean,
  listScope: Record<string, unknown> = { workspaceId }
) {
  const out: Record<string, unknown> = {};
  const need = (v: unknown) => !partial || v !== undefined;
  const str = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

  if (need(input.name)) {
    out.name = str(input.name, 120);
    if (!out.name) return { error: "Give the form a name." };
  }
  if (need(input.heading)) {
    out.heading = str(input.heading, 150);
    if (!out.heading) return { error: "Add a heading people will see on the form." };
  }
  if (input.description !== undefined) out.description = str(input.description, 500);
  if (input.buttonText !== undefined) out.buttonText = str(input.buttonText, 40) || "Subscribe";
  if (input.askName !== undefined) out.askName = !!input.askName;
  if (input.active !== undefined) out.active = !!input.active;
  if (input.fromName !== undefined) out.fromName = str(input.fromName, 100);

  if (input.redirectUrl !== undefined) {
    const url = str(input.redirectUrl, 1000);
    if (url && !/^https?:\/\/[^\s]+$/i.test(url)) return { error: "The thank-you page must be a full https:// link." };
    out.redirectUrl = url;
  }

  if (need(input.listId)) {
    if (!input.listId || !mongoose.isValidObjectId(input.listId)) return { error: "Choose the list signups go to." };
    if (!(await ContactList.exists({ _id: input.listId, ...listScope }))) return { error: "That list doesn't exist." };
    out.listId = input.listId;
  }

  if (need(input.fromDomain) || need(input.fromLocalPart)) {
    const domain = str(input.fromDomain, 253).toLowerCase();
    const local = str(input.fromLocalPart, 64).toLowerCase();
    if (!domain || !local || !LOCAL_PART_PATTERN.test(local)) return { error: "Enter a valid sender address for the confirmation email." };
    const problem = await senderProblem(workspaceId, domain, local);
    if (problem) return { error: problem };
    out.fromDomain = domain;
    out.fromLocalPart = local;
  }
  return { value: out };
}
