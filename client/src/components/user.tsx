"use client";
import { UserButton, useUser } from "@civic/auth/react";
import { useCallback, useMemo } from "react";
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import { ConnectionProvider, WalletProvider, useWallet } from '@solana/wallet-adapter-react';
import { WalletModalProvider, WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-wallets';
import { clusterApiUrl } from '@solana/web3.js';
import bs58 from 'bs58';
import { useState } from 'react';

// Import wallet adapter CSS
import '@solana/wallet-adapter-react-ui/styles.css';

// Utility function for signing a message with a Solana wallet
export async function signMessageWithWallet(signMessage: ((message: Uint8Array) => Promise<Uint8Array>) | undefined, message: string, setSignature: (sig: string) => void, setError: (err: string) => void) {
    setSignature("");
    setError("");
    if (!signMessage) {
        setError('Wallet does not support message signing.');
        return;
    }
    try {
        const encoded = new TextEncoder().encode(message);
        const signed = await signMessage(encoded);
        setSignature(bs58.encode(signed));
    } catch (err: any) {
        setError(err.message || 'Signing failed');
    }
}

function WalletActions() {
    const { publicKey, signMessage, connected } = useWallet();
    const { user } = useUser();
    const isAuthenticated = !!user;
    const [signature, setSignature] = useState<string>("");
    const [error, setError] = useState<string>("");

    // Use the common signing function
    const handleSignMessage = async () => {
        await signMessageWithWallet(signMessage, 'Hello from Solana!', setSignature, setError);
    };

    // Only allow signing if both Civic and wallet are connected
    const canSign = isAuthenticated && connected;

    return (
        <div className="w-full max-w-xl bg-white rounded-lg shadow-md p-6 mt-6 border border-gray-200">
            <div className="flex flex-col sm:flex-row sm:items-center sm:gap-8 gap-2 mb-4">
                <div className="text-lg font-semibold">
                    <span className="text-gray-700">Civic Authenticated:</span> {isAuthenticated ? <span className="text-green-600">✅</span> : <span className="text-red-600">❌</span>}
                </div>
                <div className="text-lg font-semibold">
                    <span className="text-gray-700">Wallet Connected:</span> {connected ? <span className="text-blue-700">{publicKey?.toBase58()}</span> : <span className="text-red-600">❌</span>}
                </div>
            </div>
            {canSign && (
                <>
                    <button
                        onClick={handleSignMessage}
                        className="px-6 py-2 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-lg shadow hover:from-blue-600 hover:to-purple-700 transition font-semibold mb-2"
                    >
                        ✍️ Sign Test Message
                    </button>
                    {signature && (
                        <div className="break-all text-green-700 mt-2 text-sm">
                            <strong>Signature:</strong> {signature}
                        </div>
                    )}
                    {error && (
                        <div className="text-red-600 mt-2 text-sm">Error: {error}</div>
                    )}
                </>
            )}
            {!canSign && (
                <div className="text-yellow-600 mt-2 text-sm">
                    Please authenticate with Civic and connect your wallet to sign a message.
                </div>
            )}
        </div>
    );
}

export default function CustomSignIn() {
    // Set up Solana network
    const network = WalletAdapterNetwork.Devnet;
    const endpoint = useMemo(() => clusterApiUrl(network), [network]);

    // Initialize wallet adapters
    const wallets = useMemo(
        () => [
            new PhantomWalletAdapter(),
        ],
        []
    );

    return (
        <ConnectionProvider endpoint={endpoint}>
            <WalletProvider wallets={wallets} autoConnect>
                <WalletModalProvider>
                    <div className="flex flex-col gap-4 items-start">
                        <div className="flex items-center gap-4">
                            <UserButton />
                            <WalletMultiButton />
                        </div>
                        <WalletActions />
                    </div>
                </WalletModalProvider>
            </WalletProvider>
        </ConnectionProvider>
    );
}