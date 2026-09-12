// lib/email-provisioning/types.ts
//
// Shared types for the automated email provisioning pipeline.
// Persist ProvisioningStatus against your Domain record in your DB
// (e.g. a `emailProvisioning` JSON column, or a separate table keyed
// by domainId) so you can show progress and retry failed steps.
//
// Step order matters here in a way it didn't originally: Oracle's DKIM
// key exposes its CNAME name/value the moment it's created -- it only
// reaches ACTIVE *after* Oracle detects that CNAME published in real
// DNS. So DKIM creation, publishing the CNAME, and waiting for DKIM to
// go active are three separate steps, in that order -- not one
// "create + wait for active" step like the first version had (which
// deadlocked, since nothing ever published the DNS record it was
// waiting on).

export type ProvisioningStep =
  | "oracle_email_domain"
  | "oracle_dkim_create"
  | "dns_dkim_cname"
  | "dns_mail_records" // MX + SPF + DMARC -- without these, nothing can deliver INTO the domain
  | "oracle_dkim_active"
  | "oracle_sender"
  | "mailcow_domain"
  | "mailcow_mailbox";

export type StepStatus = "pending" | "in_progress" | "done" | "failed";

export interface ProvisioningState {
  domain: string;
  customerId: string;
  defaultMailboxLocalPart: string; // e.g. "hello" -> hello@customerdomain.com
  defaultMailboxPassword: string; // generate + store securely, or force reset on first login
  defaultMailboxPasswordRevealed: boolean; // true once shown to the browser once -- never sent again after
  steps: Record<ProvisioningStep, StepStatus>;
  errors: Partial<Record<ProvisioningStep, string>>;
  oracleEmailDomainId?: string;
  oracleDkimId?: string;
  oracleDkimCnameName?: string; // e.g. oci2026b._domainkey.customerdomain.com
  oracleDkimCnameValue?: string; // e.g. oci2026b.customerdomain.com.dkim.bom1.oracleemaildelivery.com
  oracleSenderId?: string;
  updatedAt: string;
}

export function initialProvisioningState(
  domain: string,
  customerId: string,
  defaultMailboxLocalPart: string,
  defaultMailboxPassword: string
): ProvisioningState {
  return {
    domain,
    customerId,
    defaultMailboxLocalPart,
    defaultMailboxPassword,
    defaultMailboxPasswordRevealed: false,
    steps: {
      oracle_email_domain: "pending",
      oracle_dkim_create: "pending",
      dns_dkim_cname: "pending",
      dns_mail_records: "pending",
      oracle_dkim_active: "pending",
      oracle_sender: "pending",
      mailcow_domain: "pending",
      mailcow_mailbox: "pending",
    },
    errors: {},
    updatedAt: new Date().toISOString(),
  };
}
