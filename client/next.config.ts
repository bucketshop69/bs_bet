import { createCivicAuthPlugin } from "@civic/auth/nextjs"
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
};

const withCivicAuth = createCivicAuthPlugin({
  clientId: "507c4509-2d66-459e-82f1-319e956d8b46"
});

export default withCivicAuth(nextConfig)