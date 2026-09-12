import mongoose from "mongoose";

const MONGODB_URI = process.env.MONGODB_URI;

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
}

declare global {
  var __mongooseCache: MongooseCache | undefined;
}

const cache: MongooseCache = global.__mongooseCache ?? { conn: null, promise: null };
global.__mongooseCache = cache;

export async function connectToDatabase(): Promise<typeof mongoose> {
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