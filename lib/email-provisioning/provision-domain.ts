// lib/email-provisioning/provision-domain.ts
//
// Orchestrates the full pipeline for one customer domain. Designed to be
// safely re-run: each step checks/sets its own status, so a retry after a
// failure only re-runs the steps that didn't complete.
//
// Two DNS modes (see types.ts): "vercel" publishes records through the
// Vercel API; "manual" waits for the customer to add them at their own
// DNS host. Either way, a step that needs a record that isn't live yet is
// marked "waiting" and the run stops there -- the scheduler (and the
// domain's "Check now" button) re-run the pipeline later, and it carries
// on from that step.

import {
  createEmailDomain,
  waitForEmailDomainActive,
  createDkim,
  getDkimCnameInfo,
  waitForDkimActive,
  createWildcardSender,
  waitForSenderActive,
  createReturnPath,
  waitForReturnPathActive,
} from "./oracle-client";
import { addCnameRecord, addMxRecord, addSpfRecord, addDmarcRecord } from "./vercel-dns";
import { mailcowAddDomain, mailcowAddMailbox } from "./mailcow-client";
import { hasCname, hasMx, hasTxt, MAIL_SERVER_HOSTNAME, OWNERSHIP_HOST, ownershipValue } from "./dns-check";
import { ProvisioningState, initialProvisioningState } from "./types";

/** One run per domain at a time (button + scheduler could overlap). */
const running = new Set<string>();

/** Thrown to stop a run at a step that's waiting on DNS. */
class Waiting extends Error {}

export async function provisionDomainEmail(
  domain: string,
  customerId: string,
  defaultMailboxLocalPart: string,
  defaultMailboxPassword: string,
  loadState: (domain: string) => Promise<ProvisioningState | null>,
  saveState: (state: ProvisioningState) => Promise<void>
) {
  const key = domain.toLowerCase();
  if (running.has(key)) return { success: false, error: "Already running" };
  running.add(key);
  try {
    return await run(domain, customerId, defaultMailboxLocalPart, defaultMailboxPassword, loadState, saveState);
  } finally {
    running.delete(key);
  }
}

async function run(
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
  const manual = state.dnsMode === "manual";

  const markStep = async (
    step: keyof ProvisioningState["steps"],
    status: ProvisioningState["steps"][keyof ProvisioningState["steps"]],
    message?: string
  ) => {
    state.steps[step] = status;
    state.updatedAt = new Date().toISOString();
    if (message) state.errors[step] = message;
    else delete state.errors[step];
    await saveState(state);
  };
  const wait = async (step: keyof ProvisioningState["steps"], message: string): Promise<never> => {
    await markStep(step, "waiting", message);
    throw new Waiting(message);
  };
  // "Not done" includes steps missing from records created before they existed.
  const todo = (step: keyof ProvisioningState["steps"]) => state.steps[step] !== "done";

  try {
    // Step 0 (manual DNS only): prove the customer controls the domain
    // before creating anything at Oracle or Mailcow for it.
    if (manual && todo("ownership_verified")) {
      await markStep("ownership_verified", "in_progress");
      if (!(await hasTxt(`${OWNERSHIP_HOST}.${domain}`, ownershipValue(state.verificationToken ?? "")))) {
        await wait("ownership_verified", "Add the ownership TXT record shown below at your DNS provider.");
      }
      await markStep("ownership_verified", "done");
    }

    // Step 1: Oracle Email Domain
    if (todo("oracle_email_domain")) {
      await markStep("oracle_email_domain", "in_progress");
      const emailDomain = await createEmailDomain(domain);
      await waitForEmailDomainActive(emailDomain.id!);
      state.oracleEmailDomainId = emailDomain.id;
      await markStep("oracle_email_domain", "done");
    }

    // Step 2: Create the DKIM key -- does NOT wait for ACTIVE. Its CNAME
    // info is available immediately, and Oracle won't activate the key
    // until it detects that CNAME published in real DNS (see step 4).
    if (todo("oracle_dkim_create")) {
      await markStep("oracle_dkim_create", "in_progress");
      const selector = `abc-${new Date().toISOString().slice(0, 7).replace("-", "")}`; // e.g. abc-202609
      const dkim = await createDkim(state.oracleEmailDomainId!, selector);
      state.oracleDkimId = dkim.id;
      const { cnameName, cnameValue } = await getDkimCnameInfo(dkim.id!);
      state.oracleDkimCnameName = cnameName;
      state.oracleDkimCnameValue = cnameValue;
      await markStep("oracle_dkim_create", "done");
    }

    // Step 3: DKIM CNAME
    if (todo("dns_dkim_cname")) {
      await markStep("dns_dkim_cname", "in_progress");
      if (manual) {
        if (!(await hasCname(state.oracleDkimCnameName!, state.oracleDkimCnameValue!))) {
          await wait("dns_dkim_cname", "Add the DKIM CNAME record shown below.");
        }
      } else {
        // name passed to Vercel should be relative to the apex domain, e.g.
        // "oci2026b._domainkey" not the fully-qualified "oci2026b._domainkey.customerdomain.com"
        const relativeName = state.oracleDkimCnameName!.replace(`.${domain}`, "");
        await addCnameRecord({ domain, name: relativeName, value: state.oracleDkimCnameValue! });
      }
      await markStep("dns_dkim_cname", "done");
    }

    // Step 3b: MX + SPF + DMARC -- without these, mail can be SENT from
    // this domain (DKIM/sender handle that) but nothing can be DELIVERED
    // INTO it, since nothing on the internet knows where its mail server
    // is. Missing this is what silently broke inbound mail for phdinfo.in.
    // Manual mode only requires the MX (SPF/DMARC are recommended -- the
    // customer may already have an SPF record to merge into).
    if (todo("dns_mail_records")) {
      await markStep("dns_mail_records", "in_progress");
      if (manual) {
        if (!(await hasMx(domain, MAIL_SERVER_HOSTNAME))) {
          await wait("dns_mail_records", "Add the MX record shown below so mail can reach your inbox.");
        }
      } else {
        await addMxRecord({ domain, mailServerHostname: MAIL_SERVER_HOSTNAME });
        await addSpfRecord({ domain });
        await addDmarcRecord({ domain });
      }
      await markStep("dns_mail_records", "done");
    }

    // Step 4: wait for DKIM to reach ACTIVE, now that the CNAME it depends
    // on exists. Oracle can take a while to notice -- keep waiting rather
    // than failing.
    if (todo("oracle_dkim_active")) {
      await markStep("oracle_dkim_active", "in_progress");
      try {
        await waitForDkimActive(state.oracleDkimId!, manual ? 60_000 : 240_000);
      } catch (err) {
        if (/Timed out/.test(String((err as Error)?.message))) {
          await wait("oracle_dkim_active", "Waiting for Oracle to detect the DKIM record (can take up to an hour).");
        }
        throw err;
      }
      await markStep("oracle_dkim_active", "done");
    }

    // Step 5: Wildcard approved sender
    if (todo("oracle_sender")) {
      await markStep("oracle_sender", "in_progress");
      const sender = await createWildcardSender(domain);
      await waitForSenderActive(sender.id!);
      state.oracleSenderId = sender.id;
      await markStep("oracle_sender", "done");
    }

    // Step 6: Mailcow domain
    if (todo("mailcow_domain")) {
      await markStep("mailcow_domain", "in_progress");
      await mailcowAddDomain(domain);
      await markStep("mailcow_domain", "done");
    }

    // Step 7: Mailcow default mailbox
    if (todo("mailcow_mailbox")) {
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

    await setUpReturnPath(state, domain, manual, markStep, wait, todo);

    return { success: true, state };
  } catch (err: any) {
    if (err instanceof Waiting) return { success: true, waiting: true, state };
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

/** Steps 8-10: custom return path (bounce-bom.<domain>). */
async function setUpReturnPath(
  state: ProvisioningState,
  domain: string,
  manual: boolean,
  markStep: (step: keyof ProvisioningState["steps"], status: ProvisioningState["steps"][keyof ProvisioningState["steps"]], message?: string) => Promise<void>,
  wait: (step: keyof ProvisioningState["steps"], message: string) => Promise<never>,
  todo: (step: keyof ProvisioningState["steps"]) => boolean
) {
  if (todo("oracle_return_path")) {
    await markStep("oracle_return_path", "in_progress");
    const rp = await createReturnPath(state.oracleEmailDomainId!, domain);
    state.oracleReturnPathId = rp.id;
    state.returnPathCnameName = rp.cnameName;
    state.returnPathCnameValue = rp.cnameValue;
    if (!rp.cnameName || !rp.cnameValue) throw new Error("Oracle didn't return the return path's CNAME record yet -- try again shortly.");
    await markStep("oracle_return_path", "done");
  }

  if (todo("dns_return_path")) {
    await markStep("dns_return_path", "in_progress");
    if (manual) {
      if (!(await hasCname(state.returnPathCnameName!, state.returnPathCnameValue!))) {
        await wait("dns_return_path", "Add the return path CNAME record shown below.");
      }
    } else {
      await addCnameRecord({ domain, name: state.returnPathCnameName!.replace(`.${domain}`, ""), value: state.returnPathCnameValue! });
    }
    await markStep("dns_return_path", "done");
  }

  if (todo("return_path_active")) {
    await markStep("return_path_active", "in_progress");
    if (!(await waitForReturnPathActive(state.oracleReturnPathId!))) {
      await wait("return_path_active", "Waiting for Oracle to detect the return path record (can take up to an hour).");
    }
    await markStep("return_path_active", "done");
  }
}
