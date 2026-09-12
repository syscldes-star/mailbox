// lib/email-provisioning/provision-domain.ts
//
// Orchestrates the full pipeline for one customer domain. Designed to be
// safely re-run: each step checks/sets its own status, so a retry after a
// failure only re-runs the steps that didn't complete.
//
// Wire up loadState/saveState to your actual DB (Domain table / JSON column).
// This file intentionally has no DB code in it — plug in your ORM calls.

import {
  createEmailDomain,
  waitForEmailDomainActive,
  createDkim,
  getDkimCnameInfo,
  waitForDkimActive,
  createWildcardSender,
  waitForSenderActive,
} from "./oracle-client";
import { addCnameRecord, addMxRecord, addSpfRecord, addDmarcRecord } from "./vercel-dns";
import { mailcowAddDomain, mailcowAddMailbox } from "./mailcow-client";
import { ProvisioningState, initialProvisioningState } from "./types";

export async function provisionDomainEmail(
  domain: string,
  customerId: string,
  defaultMailboxLocalPart: string,
  defaultMailboxPassword: string,
  loadState: (domain: string) => Promise<ProvisioningState | null>,
  saveState: (state: ProvisioningState) => Promise<void>
) {
  let state =
    (await loadState(domain)) ??
    initialProvisioningState(domain, customerId, defaultMailboxLocalPart, defaultMailboxPassword);

  const markStep = async (
    step: keyof ProvisioningState["steps"],
    status: ProvisioningState["steps"][keyof ProvisioningState["steps"]],
    error?: string
  ) => {
    state.steps[step] = status;
    state.updatedAt = new Date().toISOString();
    if (error) state.errors[step] = error;
    else delete state.errors[step];
    await saveState(state);
  };

  try {
    // Step 1: Oracle Email Domain
    if (state.steps.oracle_email_domain !== "done") {
      await markStep("oracle_email_domain", "in_progress");
      const emailDomain = await createEmailDomain(domain);
      await waitForEmailDomainActive(emailDomain.id!);
      state.oracleEmailDomainId = emailDomain.id;
      await markStep("oracle_email_domain", "done");
    }

    // Step 2: Create the DKIM key -- does NOT wait for ACTIVE. Its CNAME
    // info is available immediately, and Oracle won't activate the key
    // until it detects that CNAME published in real DNS (see step 4).
    if (state.steps.oracle_dkim_create !== "done") {
      await markStep("oracle_dkim_create", "in_progress");
      const selector = `abc-${new Date().toISOString().slice(0, 7).replace("-", "")}`; // e.g. abc-202609
      const dkim = await createDkim(state.oracleEmailDomainId!, selector);
      state.oracleDkimId = dkim.id;
      const { cnameName, cnameValue } = await getDkimCnameInfo(dkim.id!);
      state.oracleDkimCnameName = cnameName;
      state.oracleDkimCnameValue = cnameValue;
      await markStep("oracle_dkim_create", "done");
    }

    // Step 3: Publish DKIM CNAME to Vercel DNS
    if (state.steps.dns_dkim_cname !== "done") {
      await markStep("dns_dkim_cname", "in_progress");
      // name passed to Vercel should be relative to the apex domain, e.g.
      // "oci2026b._domainkey" not the fully-qualified "oci2026b._domainkey.customerdomain.com"
      const relativeName = state.oracleDkimCnameName!.replace(`.${domain}`, "");
      await addCnameRecord({
        domain,
        name: relativeName,
        value: state.oracleDkimCnameValue!,
      });
      await markStep("dns_dkim_cname", "done");
    }

    // Step 3b: MX + SPF + DMARC -- without these, mail can be SENT from
    // this domain (DKIM/sender handle that) but nothing can be DELIVERED
    // INTO it, since nothing on the internet knows where its mail server
    // is. Missing this is what silently broke inbound mail for phdinfo.in.
    if (state.steps.dns_mail_records !== "done") {
      await markStep("dns_mail_records", "in_progress");
      const mailServerHostname = process.env.MAILCOW_SERVER_HOSTNAME ?? "email.vidyarishi.in";
      await addMxRecord({ domain, mailServerHostname });
      await addSpfRecord({ domain });
      await addDmarcRecord({ domain });
      await markStep("dns_mail_records", "done");
    }

    // Step 4: NOW wait for DKIM to reach ACTIVE, now that the CNAME it
    // depends on actually exists in DNS.
    if (state.steps.oracle_dkim_active !== "done") {
      await markStep("oracle_dkim_active", "in_progress");
      await waitForDkimActive(state.oracleDkimId!);
      await markStep("oracle_dkim_active", "done");
    }

    // Step 5: Wildcard approved sender
    if (state.steps.oracle_sender !== "done") {
      await markStep("oracle_sender", "in_progress");
      const sender = await createWildcardSender(domain);
      await waitForSenderActive(sender.id!);
      state.oracleSenderId = sender.id;
      await markStep("oracle_sender", "done");
    }

    // Step 6: Mailcow domain
    if (state.steps.mailcow_domain !== "done") {
      await markStep("mailcow_domain", "in_progress");
      await mailcowAddDomain(domain);
      await markStep("mailcow_domain", "done");
    }

    // Step 7: Mailcow default mailbox
    if (state.steps.mailcow_mailbox !== "done") {
      await markStep("mailcow_mailbox", "in_progress");
      await mailcowAddMailbox({
        domain,
        localPart: state.defaultMailboxLocalPart,
        password: state.defaultMailboxPassword,
        // Leave the name unset rather than a generic placeholder like
        // "domain.com mailbox" -- Mailcow/SOGo falls back to showing the
        // raw email address as the sender name when this is empty, same
        // as how manually-added mailboxes already behave.
        fullName: "",
      });
      await markStep("mailcow_mailbox", "done");
    }

    return { success: true, state };
  } catch (err: any) {
    // Find which step was in_progress when it threw, mark it failed.
    const inProgressStep = (Object.keys(state.steps) as (keyof ProvisioningState["steps"])[]).find(
      (s) => state.steps[s] === "in_progress"
    );
    if (inProgressStep) {
      await markStep(inProgressStep, "failed", err?.message ?? String(err));
    }
    return { success: false, state, error: err?.message ?? String(err) };
  }
}
