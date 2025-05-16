"use client";
import { UserButton, useUser } from "@civic/auth-web3/react";
import { userHasWallet } from "@civic/auth-web3";
import { useEffect, useState } from "react";
import { useSolanaWallet } from "../hooks/useSolanaWallet";
import { useWalletBalance } from "../hooks/useWalletBalance";

export default function Navbar() {
    const user = useUser();
    const { publicKey, connected } = useSolanaWallet();
    const { balance, isLoading } = useWalletBalance();
    const [hasWallet, setHasWallet] = useState(false);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        const initializeUser = async () => {
            console.log(user);
            const walletCheck = await userHasWallet(user);
            console.log(walletCheck);
            setHasWallet(walletCheck);
        };
        initializeUser();
    }, [user]);

    const copyToClipboard = () => {
        if (publicKey) {
            navigator.clipboard.writeText(publicKey.toString());
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    const formatAddress = (address: string) => {
        return `${address.slice(0, 4)}...${address.slice(-4)}`;
    };

    return (
        <nav className="w-full border rounded-md from-blue-700 to-purple-700 shadow flex items-center justify-between px-8 py-4">
            <div className="text-1xl font-bold text-white tracking-widest">
                <div className="flex items-center gap-4">
                    {connected && publicKey && (
                        <div className="flex flex-col items-end">
                            <button
                                onClick={copyToClipboard}
                                className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded-md transition-colors flex items-center gap-2"
                            >
                                <span>{formatAddress(publicKey.toString())}</span>
                                <span>{copied ? "✓" : "📋"}</span>
                            </button>
                            <div className="text-sm text-white mt-1">
                                {isLoading ? (
                                    <span>Loading...</span>
                                ) : balance !== null ? (
                                    <span>{balance.toFixed(4)} SOL</span>
                                ) : (
                                    <span>--</span>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <UserButton />
        </nav>
    );
}

