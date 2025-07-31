import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  experimental: {
    // Control PPR via environment variable
    ppr: process.env.ENABLE_PPR === 'true',
  },
  images: {
    remotePatterns: [
      {
        hostname: 'avatar.vercel.sh',
      },
    ],
  },
};

export default nextConfig;
