"use client";
import { UserButton } from "@civic/auth/react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

export default function Navbar() {
    return (
        <nav className="w-full bg-gradient-to-r from-blue-700 to-purple-700 shadow flex items-center justify-between px-8 py-4">
            <div className="text-2xl font-bold text-white tracking-widest">BS BET</div>
            <div className="flex items-center gap-4">
                <UserButton />
                <WalletMultiButton />
            </div>
        </nav>
    );
} 