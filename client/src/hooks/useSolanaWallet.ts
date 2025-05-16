import { useUser } from "@civic/auth-web3/react";
import { PublicKey } from "@solana/web3.js";

export interface SolanaWalletAdapter {
    publicKey: PublicKey;
    signTransaction: (transaction: any) => Promise<any>;
    signAllTransactions: (transactions: any[]) => Promise<any[]>;
    signMessage: (message: Uint8Array) => Promise<Uint8Array>;
    connecting: boolean;
    connected: boolean;
    _connected?: boolean; // For Metakeep adapter
    _events?: any;
    _eventsCount?: number;
    sdk?: any;
    readyState?: string;
}

export function useSolanaWallet() {
    const civicUser = useUser();

    // For Metakeep wallet, check solana.wallet
    const metakeepWallet = civicUser?.solana?.wallet;
    // For standard Civic wallet
    const standardWallet = civicUser?.wallet;

    // Prefer Metakeep if available, otherwise fall back to standard Civic wallet
    const solanaWallet = metakeepWallet || standardWallet;

    const isConnected =
        (solanaWallet?.connected) || // Standard connected property
        (solanaWallet?._connected) || // Metakeep _connected property
        (solanaWallet?.readyState === "Loadable"); // Metakeep readyState

    // Return a standard object that can be used in components
    return {
        wallet: solanaWallet as SolanaWalletAdapter | undefined,
        publicKey: solanaWallet?.publicKey,
        connected: !!isConnected,
        isLoading: civicUser.isLoading,
        signMessage: solanaWallet?.signMessage,
        signTransaction: solanaWallet?.signTransaction,
        signAllTransactions: solanaWallet?.signAllTransactions,
        userEmail: civicUser?.user?.email
    };
} 