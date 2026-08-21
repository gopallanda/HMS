import type { NextConfig } from 'next';

/**
 * Hospital logos are served from the public `branding` bucket on the project's
 * own Supabase host, so next/image needs that host allow-listed. Derived from
 * the env var rather than hardcoded: the URL differs per environment, and a
 * wrong hostname here shows up as a silently broken logo on every invoice.
 */
function supabaseImagePatterns(): NonNullable<NextConfig['images']>['remotePatterns'] {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return [];

  try {
    const { protocol, hostname } = new URL(url);
    return [
      {
        protocol: protocol.replace(':', '') as 'http' | 'https',
        hostname,
        pathname: '/storage/v1/object/public/**',
      },
    ];
  } catch {
    // A malformed URL is already reported loudly by lib/env.ts at request time.
    return [];
  }
}

const nextConfig: NextConfig = {
  images: {
    remotePatterns: supabaseImagePatterns(),
  },
};

export default nextConfig;
