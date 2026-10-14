// instrumentation.ts
//
// Next.js calls register() once when the server process starts. The
// NEXT_RUNTIME check must stay in exactly this form so the Node-only
// code is left out of the edge build.

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { onServerStart } = await import("./instrumentation-node");
    await onServerStart();
  }
}
