import * as common from "oci-common";
import * as email from "oci-email";

function getProvider(): common.SimpleAuthenticationDetailsProvider {
  const privateKey = (process.env.OCI_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  return new common.SimpleAuthenticationDetailsProvider(
    process.env.OCI_TENANCY_OCID!,
    process.env.OCI_USER_OCID!,
    process.env.OCI_FINGERPRINT!,
    privateKey,
    null,
    common.Region.fromRegionId(process.env.OCI_REGION!)
  );
}

function getClient(): email.EmailClient {
  return new email.EmailClient({ authenticationDetailsProvider: getProvider() });
}

const COMPARTMENT_ID = process.env.OCI_COMPARTMENT_OCID!;

/** Step 1: create (or reuse) the Email Domain for a customer's domain. */
export async function createEmailDomain(domainName: string) {
  const client = getClient();

  // Check if it already exists first (idempotent — customers may retry).
  const existing = await client.listEmailDomains({
    compartmentId: COMPARTMENT_ID,
    name: domainName,
  });
  if (existing.emailDomainCollection.items.length > 0) {
    return existing.emailDomainCollection.items[0];
  }

  const response = await client.createEmailDomain({
    createEmailDomainDetails: {
      compartmentId: COMPARTMENT_ID,
      name: domainName,
      description: `Auto-provisioned for customer domain ${domainName}`,
    },
  });
  return response.emailDomain;
}

/** Poll until the email domain is ACTIVE. */
export async function waitForEmailDomainActive(emailDomainId: string, timeoutMs = 120_000) {
  const client = getClient();
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { emailDomain } = await client.getEmailDomain({ emailDomainId });
    if (emailDomain.lifecycleState === "ACTIVE") return emailDomain;
    if (emailDomain.lifecycleState === "FAILED") {
      throw new Error(`Oracle email domain ${emailDomainId} entered FAILED state`);
    }
    await sleep(3000);
  }
  throw new Error(`Timed out waiting for email domain ${emailDomainId} to become ACTIVE`);
}

/** Step 2: create (or reuse) a DKIM key for the email domain. */
/** Step 2: create (or reuse) a DKIM key for the email domain. Returns
 * immediately -- does NOT wait for ACTIVE, since the CNAME info is
 * available right away and Oracle won't activate the key until *after*
 * that CNAME is published in real DNS (see getDkimCnameInfo below). */
export async function createDkim(emailDomainId: string, selector: string) {
  const client = getClient();

  // Idempotent, same as createEmailDomain -- a retry reuses the existing
  // key rather than creating a second, orphaned one.
  const existing = await client.listDkims({ emailDomainId });
  if (existing.dkimCollection.items.length > 0) {
    return existing.dkimCollection.items[0];
  }

  const response = await client.createDkim({
    createDkimDetails: {
      name: selector,
      emailDomainId,
      description: "Auto-provisioned DKIM",
    },
  });
  return response.dkim;
}

/** Step 3 (input): read the CNAME name/value Oracle assigned to this DKIM
 * key. Available immediately after creation -- confirmed against the
 * OCI Console's own DKIM detail page, which shows "CNAME Record" and
 * "CNAME Value" columns before the key ever reaches ACTIVE. */
export async function getDkimCnameInfo(dkimId: string) {
  const client = getClient();
  const { dkim } = await client.getDkim({ dkimId });
  // Field names per SDK version — confirm against your installed
  // oci-email version's Dkim model if this comes back undefined; the
  // OCI Console labels these "CNAME Record" and "CNAME Value".
  return {
    cnameName: (dkim as any).dnsSubdomainName as string,
    cnameValue: (dkim as any).cnameRecordValue as string,
  };
}

/** Step 4: poll until DKIM reaches ACTIVE -- call this AFTER the CNAME
 * from getDkimCnameInfo has actually been published to DNS, not before.
 * Oracle needs to detect the record before it will activate the key. */
export async function waitForDkimActive(dkimId: string, timeoutMs = 240_000) {
  const client = getClient();
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { dkim } = await client.getDkim({ dkimId });
    if (dkim.lifecycleState === "ACTIVE") return dkim;
    if (dkim.lifecycleState === "FAILED") {
      throw new Error(`Oracle DKIM ${dkimId} entered FAILED state`);
    }
    await sleep(5000);
  }
  throw new Error(
    `Timed out waiting for DKIM ${dkimId} to become ACTIVE. Check the OCI Console's DKIM tab -- ` +
      `if "Customer DNS Status" still shows "Needs Attention", the CNAME hasn't propagated/been ` +
      `detected yet; DNS propagation can occasionally take longer than this timeout even after ` +
      `the record is correctly published.`
  );
}

/** Step 4: create a wildcard approved sender for the whole domain. Requires DKIM ACTIVE first. */
export async function createWildcardSender(domainName: string) {
  const client = getClient();

  // Idempotent, same as createEmailDomain/createDkim -- @vidyarishi.in was
  // already created manually before this pipeline existed, and any
  // customer domain retry should reuse an existing sender rather than
  // erroring on Oracle's "already exists" response.
  //
  // Note: unlike listEmailDomains/listDkims, ListSendersResponse puts
  // results directly under `.items`, not wrapped in a `*Collection`
  // object -- and the filter param is `domain` (exact match), not
  // `emailAddressContains`.
  const existing = await client.listSenders({
    compartmentId: COMPARTMENT_ID,
    domain: domainName,
  });
  const match = existing.items.find(
    (s) => s.emailAddress?.toLowerCase() === `@${domainName}`.toLowerCase()
  );
  if (match) return match;

  const response = await client.createSender({
    createSenderDetails: {
      compartmentId: COMPARTMENT_ID,
      emailAddress: `@${domainName}`,
    },
  });
  return response.sender;
}

export async function waitForSenderActive(senderId: string, timeoutMs = 60_000) {
  const client = getClient();
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { sender } = await client.getSender({ senderId });
    if (sender.lifecycleState === "ACTIVE") return sender;
    if (sender.lifecycleState === "FAILED") {
      throw new Error(`Oracle sender ${senderId} entered FAILED state`);
    }
    await sleep(2000);
  }
  throw new Error(`Timed out waiting for sender ${senderId} to become ACTIVE`);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}