import { createCivicAuthPlugin } from "@civic/auth-web3/nextjs"
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
};

// Get Civic client ID from environment variables
const civicClientId = process.env.NEXT_PUBLIC_CIVIC_CLIENT_ID || "507c4509-2d66-459e-82f1-319e956d8b46";

const withCivicAuth = createCivicAuthPlugin({
  clientId: civicClientId
});

export default withCivicAuth(nextConfig)