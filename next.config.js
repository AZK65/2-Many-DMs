/** @type {import('next').NextConfig} */
const nextConfig = {
  // Never let `next build` overwrite chunks used by a running `next dev`.
  // Sharing `.next` caused intermittent "Cannot find module ./1682.js"
  // failures whenever a production verification build ran during development.
  distDir: process.env.OMNI_NEXT_DIST_DIR || (process.env.NODE_ENV === "development" ? ".next-dev" : ".next"),
  images: {
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
  // Types are checked in CI/tsc; don't let a lint nit block the prod build.
  eslint: { ignoreDuringBuilds: true },
  // GramJS (MTProto) is heavy and Node-only — keep it external to the bundle so
  // the Telegram login route works in the Node runtime.
  experimental: {
    serverComponentsExternalPackages: [
      "telegram",
      "nspell",
      "dictionary-en",
      "dictionary-fr",
    ],
  },
};

module.exports = nextConfig;
