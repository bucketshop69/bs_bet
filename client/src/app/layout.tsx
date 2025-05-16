"use client";
import { CivicAuthProvider } from "@civic/auth/nextjs";
import Navbar from "../components/Navbar";
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-wallets';
import { clusterApiUrl } from '@solana/web3.js';
import { useMemo } from "react";
import '@solana/wallet-adapter-react-ui/styles.css';
import PriceTracker from "../components/PriceTracker";
import BetForm from "../components/BetForm";
const network = WalletAdapterNetwork.Devnet;
const endpoint = clusterApiUrl(network);
const wallets = [new PhantomWalletAdapter()];

function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script src="https://cdn.tailwindcss.com"></script>
      </head>
      <body className="bg-gray-800 min-h-screen text-gray-100">
        <CivicAuthProvider>
          <ConnectionProvider endpoint={endpoint}>
            <WalletProvider wallets={wallets} autoConnect>
              <WalletModalProvider>
                <div className="container mx-auto px-4 py-8 max-w-5xl">
                  <Navbar />
                  <div className="flex flex-col md:flex-row gap-8 justify-end items-stretch mt-8">
                    <PriceTracker />
                    <BetForm />
                  </div>
                  <main className="mt-8 bg-gray-800 rounded-lg shadow-lg p-6 border border-gray-700">
                    {children}
                  </main>
                </div>
              </WalletModalProvider>
            </WalletProvider>
          </ConnectionProvider>
        </CivicAuthProvider>
      </body>
    </html>
  )
}

export default Layout;