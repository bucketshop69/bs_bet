const { createCivicAuthPlugin } = require("@civic/auth-web3/nextjs");

/** @type {import('next').NextConfig} */
const nextConfig = {
    typescript: {
        ignoreBuildErrors: true, // Ignore TypeScript errors during build
    },
    eslint: {
        ignoreDuringBuilds: true, // Ignore ESLint errors during build
    },
    compiler: {
        styledComponents: true,
    }
};

// Get Civic client ID from environment variables
const civicClientId = process.env.NEXT_PUBLIC_CIVIC_CLIENT_ID || "507c4509-2d66-459e-82f1-319e956d8b46";

const withCivicAuth = createCivicAuthPlugin({
    clientId: civicClientId
});

module.exports = withCivicAuth(nextConfig); 