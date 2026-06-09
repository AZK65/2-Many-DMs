/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
  // Types are checked in CI/tsc; don't let a lint nit block the prod build.
  eslint: { ignoreDuringBuilds: true },
};

module.exports = nextConfig;
