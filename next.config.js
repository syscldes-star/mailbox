/** @type {import('next').NextConfig} */
const nextConfig = {
  // Internal service — no need for image optimization domains, etc.
  // Add CORS/auth restrictions in middleware.ts so only your `frontend`
  // app (or your internal network) can reach these routes.
};

module.exports = nextConfig;
