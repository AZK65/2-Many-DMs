// Public static site only. This app has no middleware, account APIs or database.
export default {
  output: "export",
  images: { unoptimized: true },
  experimental: { externalDir: true, cpus: 2 },
};
