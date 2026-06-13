/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
  // Types are checked in CI/tsc; don't let a lint nit block the prod build.
  eslint: { ignoreDuringBuilds: true },
  // GramJS (MTProto) is heavy and Node-only — keep it external to the bundle so
  // the Telegram login route works in the Node runtime.
  experimental: {
    serverComponentsExternalPackages: ["telegram"],
  },
};

module.exports = nextConfig;
