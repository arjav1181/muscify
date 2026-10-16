import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    /**
     * Turbopack auto-detects the project root by walking up for a lockfile.
     * This project can sit inside a larger workspace that has its own
     * `package-lock.json`, which would otherwise win and make module resolution
     * happen against the wrong directory.
     *
     * `process.cwd()` rather than `import.meta.dirname`: it resolves identically
     * whether the config is loaded as ESM or CJS, and both `npm run build` and
     * Vercel's build step run from the project root.
     */
    root: process.cwd(),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;