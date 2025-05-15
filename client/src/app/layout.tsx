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
const network = WalletAdapterNetwork.Devnet;
const endpoint = clusterApiUrl(network);
const wallets = [new PhantomWalletAdapter()];

function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <CivicAuthProvider>
          <ConnectionProvider endpoint={endpoint}>
            <WalletProvider wallets={wallets} autoConnect>
              <WalletModalProvider>
                <Navbar />
                {children}
              </WalletModalProvider>
            </WalletProvider>
          </ConnectionProvider>
        </CivicAuthProvider>
      </body>
    </html>
  )
}

export default Layout;