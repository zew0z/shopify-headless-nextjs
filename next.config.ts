import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A self-contained server for the NOTIXV container image (the Dockerfile kit-install adds).
  output: "standalone",
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "cdn.shopify.com",
        pathname: "/**",
      },
    ],
  },
};

export default nextConfig;
