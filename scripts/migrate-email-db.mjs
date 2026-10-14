// scripts/migrate-email-db.mjs
//
// One-time copy of the email service's collections from the main
// database (MONGODB_URI) into the email database (EMAIL_MONGODB_URI).
//
//   node scripts/migrate-email-db.mjs           # dry run: shows counts only
//   node scripts/migrate-email-db.mjs --apply   # copies
//
// Safe to re-run: documents are upserted by _id, so running it twice
// doesn't duplicate anything. Where the source and target both have a
// document for the same domain (or unsubscribed address), the source
// wins. The originals are left in place as a
// backup -- drop them by hand once the app is confirmed working.

import { readFileSync, existsSync } from "node:fs";
import mongoose from "mongoose";

// Each collection with the fields that make a document unique besides
// _id. If the target already holds a *different* document with the same
// key -- e.g. a domain re-provisioned against the new database before
// this ran -- that copy is replaced by the original from the source.
const COLLECTIONS = {
  emailprovisionings: ["domain"],
  bulkemailjobs: [],
  emailsuppressions: ["workspaceId", "email"],
};
const apply = process.argv.includes("--apply");

// Load .env (without overriding variables already set in the shell).
for (const file of [".env.local", ".env"]) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}

const { MONGODB_URI, EMAIL_MONGODB_URI } = process.env;
if (!MONGODB_URI || !EMAIL_MONGODB_URI) {
  console.error("Both MONGODB_URI and EMAIL_MONGODB_URI must be set (in .env or the shell).");
  process.exit(1);
}

const source = new mongoose.mongo.MongoClient(MONGODB_URI);
const target = new mongoose.mongo.MongoClient(EMAIL_MONGODB_URI);

try {
  await Promise.all([source.connect(), target.connect()]);
  const from = source.db();
  const to = target.db();

  if (from.databaseName === to.databaseName && MONGODB_URI === EMAIL_MONGODB_URI) {
    console.error("MONGODB_URI and EMAIL_MONGODB_URI point at the same database -- nothing to do.");
    process.exit(1);
  }

  console.log(`From: ${from.databaseName}  ->  To: ${to.databaseName}${apply ? "" : "   (dry run)"}\n`);

  for (const [name, keyFields] of Object.entries(COLLECTIONS)) {
    const docs = await from.collection(name).find({}).toArray();
    const existing = await to.collection(name).countDocuments();

    // Target documents that clash with a source document on the unique
    // key but have a different _id.
    const conflicts = [];
    if (keyFields.length > 0) {
      for (const doc of docs) {
        const key = Object.fromEntries(keyFields.map((f) => [f, doc[f]]));
        const clash = await to.collection(name).findOne({ ...key, _id: { $ne: doc._id } });
        if (clash) conflicts.push({ key, _id: clash._id });
      }
    }
    for (const c of conflicts) {
      console.log(`${name.padEnd(20)} ${apply ? "replacing" : "would replace"} target copy of ${JSON.stringify(c.key)}`);
    }

    if (!apply || docs.length === 0) {
      console.log(`${name.padEnd(20)} ${docs.length} to copy (${existing} already in target)`);
      continue;
    }
    if (conflicts.length > 0) {
      await to.collection(name).deleteMany({ _id: { $in: conflicts.map((c) => c._id) } });
    }
    const result = await to.collection(name).bulkWrite(
      docs.map((doc) => ({ replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true } }))
    );
    const total = await to.collection(name).countDocuments();
    console.log(
      `${name.padEnd(20)} copied ${docs.length} (new ${result.upsertedCount}, updated ${result.modifiedCount}); target now has ${total}`
    );
  }

  console.log(apply ? "\nDone. Originals were left in place." : "\nDry run only. Re-run with --apply to copy.");
} finally {
  await Promise.all([source.close(), target.close()]);
}
