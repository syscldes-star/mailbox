import mongoose from "mongoose";

/**
 * Two databases:
 *  - MONGODB_URI: the platform's main database, shared with main/site.
 *    Users, workspace memberships, websites and custom domains live
 *    here, and this app only reads them.
 *  - EMAIL_MONGODB_URI: this app's own database, holding everything the
 *    email service writes (domain provisioning state, bulk sends,
 *    unsubscribes). Optional -- when unset, those collections stay in
 *    the main database as before.
 *
 * Email models register on emailDb() rather than the default mongoose
 * connection, which is what routes them to the right database.
 */
const MONGODB_URI = process.env.MONGODB_URI;
const EMAIL_MONGODB_URI = process.env.EMAIL_MONGODB_URI;

/**
 * Next.js dev mode hot-reloads modules on every file save, which would
 * normally open a brand new Mongoose connection each time and quickly
 * exhaust MongoDB's connection limit. Caching the connection (and the
 * in-flight connect promise) on the global object survives module
 * reloads, so we only ever connect once per server process.
 */
interface MongooseCache {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
  emailConn?: mongoose.Connection;
  emailPromise?: Promise<mongoose.Connection> | null;
}

declare global {
  var __mongooseCache: MongooseCache | undefined;
}

const cache: MongooseCache = global.__mongooseCache ?? { conn: null, promise: null };
global.__mongooseCache = cache;

/** The connection email models register on. Creating it doesn't wait
 * for it to open -- connectToDatabase() does that. */
export function emailDb(): mongoose.Connection {
  if (!EMAIL_MONGODB_URI) return mongoose.connection;
  if (!cache.emailConn) {
    cache.emailConn = mongoose.createConnection(EMAIL_MONGODB_URI, { bufferCommands: false });
  }
  return cache.emailConn;
}

async function connectMain(): Promise<typeof mongoose> {
  if (cache.conn) {
    return cache.conn;
  }

  if (!MONGODB_URI) {
    throw new Error(
      "MONGODB_URI is not set. Add it to your .env.local file -- see README/setup notes for how to get a connection string from MongoDB Atlas."
    );
  }

  if (!cache.promise) {
    cache.promise = mongoose.connect(MONGODB_URI, {
      bufferCommands: false,
    });
  }

  try {
    cache.conn = await cache.promise;
  } catch (error) {
    // Reset the cached promise on failure so the next request retries
    // the connection instead of permanently reusing a rejected promise.
    cache.promise = null;
    throw error;
  }

  return cache.conn;
}

async function connectEmail(): Promise<void> {
  if (!EMAIL_MONGODB_URI) return;
  if (!cache.emailPromise) {
    const conn = emailDb();
    // After a failed attempt, reopen the same connection object rather
    // than creating a new one -- the email models are bound to it.
    cache.emailPromise =
      conn.readyState === mongoose.ConnectionStates.disconnected
        ? conn.openUri(EMAIL_MONGODB_URI, { bufferCommands: false })
        : conn.asPromise();
  }
  try {
    await cache.emailPromise;
  } catch (error) {
    // Same retry-on-next-request behavior as the main connection.
    cache.emailPromise = null;
    throw error;
  }
}

/** Opens both databases. Every route and worker calls this before
 * touching any model, so both are always ready. */
export async function connectToDatabase(): Promise<typeof mongoose> {
  const [main] = await Promise.all([connectMain(), connectEmail()]);
  return main;
}

/**
 * Registers an email-database model. In development the model is always
 * rebuilt from its current schema: Next's hot reload keeps the old
 * compiled model on the cached connection, so a schema change (a new
 * field or status) would otherwise be silently ignored until the dev
 * server restarted. In production each model is compiled once.
 */
export function emailModel<T>(name: string, schema: mongoose.Schema<T>): mongoose.Model<T> {
  const db = emailDb();
  if (db.models[name]) {
    if (process.env.NODE_ENV === "production") return db.models[name] as mongoose.Model<T>;
    db.deleteModel(name);
  }
  return db.model<T>(name, schema);
}
