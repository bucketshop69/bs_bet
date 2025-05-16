import { SolanaWalletAdapter } from "../hooks/useSolanaWallet";

/**
 * Signs a message using the provided wallet adapter
 * Handles both string input and Uint8Array
 */
export async function signMessage(
    wallet: SolanaWalletAdapter | undefined,
    message: string | Uint8Array
): Promise<Uint8Array | null> {
    if (!wallet?.signMessage) {
        console.error("Wallet doesn't support message signing");
        return null;
    }

    try {
        const messageBuffer = typeof message === 'string'
            ? new TextEncoder().encode(message)
            : message;

        return await wallet.signMessage(messageBuffer);
    } catch (error) {
        console.error("Error signing message:", error);
        return null;
    }
}

/**
 * Creates a formatted signature array from a Uint8Array signature
 * (Used for Anchor instruction compatibility)
 */
export function formatSignatureForAnchor(signature: Uint8Array | null): number[] | null {
    if (!signature) return null;

    return Array.from(signature);
}

/**
 * Helper to sign a message and format it for Anchor in one step
 */
export async function signAndFormatMessage(
    wallet: SolanaWalletAdapter | undefined,
    message: string
): Promise<{ signature: number[] | null, signatureBytes: Uint8Array | null }> {
    const signatureBytes = await signMessage(wallet, message);
    const signature = formatSignatureForAnchor(signatureBytes);

    return { signature, signatureBytes };
} 