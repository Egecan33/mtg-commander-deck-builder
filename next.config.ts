import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Self-contained server in .next/standalone, used by the portable release bundles (packaging/).
  output: 'standalone',
  serverExternalPackages: ['better-sqlite3'],
  // Next loads its route runtimes by name at run time; the tracer misses them under pnpm.
  outputFileTracingIncludes: { '*': ['node_modules/next/dist/compiled/next-server/*.runtime.prod.js'] },
  // The card database and images live outside the app; never trace them into the build.
  outputFileTracingExcludes: { '*': ['data/**', 'dist/**', 'release/**'] },
};

export default nextConfig;
