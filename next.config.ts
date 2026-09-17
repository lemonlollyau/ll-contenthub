import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Calendar workbooks can be larger than the 1 MB default.
    serverActions: { bodySizeLimit: "4mb" },
  },
};

export default nextConfig;
