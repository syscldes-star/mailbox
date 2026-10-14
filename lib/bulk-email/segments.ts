// lib/bulk-email/segments.ts
//
// Segment filters over a saved contact list, e.g. "city equals Delhi AND
// plan is not empty". Runs in the browser when picking recipients.

export type SegmentOp = "equals" | "not_equals" | "contains" | "not_contains" | "is_empty" | "not_empty";

export interface SegmentCondition {
  column: string;
  op: SegmentOp;
  value: string;
}

export const SEGMENT_OPS: { op: SegmentOp; label: string; needsValue: boolean }[] = [
  { op: "equals", label: "is", needsValue: true },
  { op: "not_equals", label: "is not", needsValue: true },
  { op: "contains", label: "contains", needsValue: true },
  { op: "not_contains", label: "doesn't contain", needsValue: true },
  { op: "is_empty", label: "is empty", needsValue: false },
  { op: "not_empty", label: "is not empty", needsValue: false },
];

interface ContactLike {
  email: string;
  name?: string;
  vars?: Record<string, string>;
}

function columnValue(c: ContactLike, column: string): string {
  if (column === "email") return c.email;
  if (column === "name") return c.name ?? "";
  return c.vars?.[column] ?? "";
}

function matches(c: ContactLike, cond: SegmentCondition): boolean {
  const actual = columnValue(c, cond.column).trim().toLowerCase();
  const wanted = cond.value.trim().toLowerCase();
  switch (cond.op) {
    case "equals":
      return actual === wanted;
    case "not_equals":
      return actual !== wanted;
    case "contains":
      return actual.includes(wanted);
    case "not_contains":
      return !actual.includes(wanted);
    case "is_empty":
      return actual === "";
    case "not_empty":
      return actual !== "";
  }
}

/** Contacts matching all (or any) of the conditions; no conditions = everyone. */
export function filterContacts<T extends ContactLike>(contacts: T[], conditions: SegmentCondition[], match: "all" | "any"): T[] {
  const active = conditions.filter((c) => c.column);
  if (active.length === 0) return contacts;
  return contacts.filter((c) => (match === "all" ? active.every((cond) => matches(c, cond)) : active.some((cond) => matches(c, cond))));
}
