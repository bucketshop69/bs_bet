import React, { useEffect, useState, useCallback, useRef } from "react";
import UserProfile from "./UserProfile";
import * as anchor from '@coral-xyz/anchor';
import { Program, AnchorProvider, Wallet } from '@coral-xyz/anchor';
import idlJson from './bs_bet.json';
import type { BsBet } from './bs_bet';
import { BN } from "@coral-xyz/anchor";
import { Connection as SolanaConnection, PublicKey, SystemProgram, Keypair, Transaction } from "@solana/web3.js";
import { useSolanaWallet } from "../hooks/useSolanaWallet";
import { signAndFormatMessage } from "../utils/signUtils";

interface CivicWallet {
    publicKey: PublicKey;
    signTransaction: (transaction: Transaction) => Promise<Transaction>;
    signAllTransactions: (transactions: Transaction[]) => Promise<Transaction[]>;
    signMessage: (message: Uint8Array) => Promise<Uint8Array>;
}

interface CivicUser {
    wallet: CivicWallet;
}

export type ClientActiveBet = { /* ... (same as before) ... */ };
// Read constants from environment variables
const PYTH_SOL_USD_PRICE_ACCOUNT = new anchor.web3.PublicKey(
    process.env.NEXT_PUBLIC_PYTH_SOL_USD_PRICE_ACCOUNT || "7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE"
);
const PROGRAM_ID = new anchor.web3.PublicKey(
    process.env.NEXT_PUBLIC_BSBET_PROGRAM_ID || "3awHJrzJbNCCLcQNEdh5mcVfPZW55w5v7tQhDwkx7Hpt"
);
// MagicBlock RPC Endpoint
const MAGICBLOCK_RPC_ENDPOINT = process.env.NEXT_PUBLIC_MAGICBLOCK_RPC_URL || "https://devnet.magicblock.app/";

interface DisplayableActiveBet extends ClientActiveBet { publicKey: string; }

// First, let's add a utility function at the beginning of the file after imports
const formatActionFeedbackMessage = (message: string) => {
    // For messages from handleBet that follow the format "Tx: {signature} via {provider}"
    if (message.startsWith("Tx: ")) {
        const parts = message.split(" via ");
        if (parts.length === 2) {
            const txSig = parts[0].replace("Tx: ", "");
            const viaText = parts[1];

            return (
                <span>
                    Tx: <a
                        href={`https://explorer.solana.com/tx/${txSig}?cluster=devnet`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-400 hover:underline"
                    >
                        {txSig.substring(0, 12)}...{txSig.substring(txSig.length - 4)}
                    </a> via {viaText}
                </span>
            );
        }
    }

    // For messages that contain "Tx: {signature}" anywhere in the text (like delegation success messages)
    const txMatch = message.match(/Tx:\s*([a-zA-Z0-9]{43,})/);
    if (txMatch && txMatch[1]) {
        const txSig = txMatch[1];
        const beforeTx = message.split(`Tx: ${txSig}`)[0];

        return (
            <span>
                {beforeTx}Tx: <a
                    href={`https://explorer.solana.com/tx/${txSig}?cluster=devnet`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 hover:underline"
                >
                    {txSig.substring(0, 12)}...{txSig.substring(txSig.length - 4)}
                </a>
            </span>
        );
    }

    // If not a transaction message, return as is
    return message;
};

export default function BetForm() {
    const [feedback, setFeedback] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [actionFeedbackMessage, setActionFeedbackMessage] = useState<string>("");

    // Use our custom hook to get the wallet
    const { wallet: userWallet, publicKey: userPublicKey, connected } = useSolanaWallet();
    const userAuthority = userPublicKey;

    // Standard L1 Connection
    const [standardConnection, setStandardConnection] = useState<SolanaConnection | null>(null);

    // Initialize connection
    useEffect(() => {
        const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com";
        const connection = new SolanaConnection(rpcUrl, "confirmed");
        setStandardConnection(connection);
    }, []);

    // Standard L1 Program & Provider
    const [l1Program, setL1Program] = useState<Program<BsBet> | null>(null);
    const [l1Provider, setL1Provider] = useState<AnchorProvider | null>(null);

    // --- NEW: Ephemeral Program & Provider (for MagicBlock) ---
    const [ephemeralProgram, setEphemeralProgram] = useState<Program<BsBet> | null>(null);
    const ephemeralProviderRef = useRef<AnchorProvider | null>(null); // Use ref to avoid re-triggering useEffects excessively

    const [userProfilePda, setUserProfilePda] = useState<PublicKey | null>(null);
    const [userAuthStatePda, setUserAuthStatePda] = useState<PublicKey | null>(null);
    const [profileData, setProfileData] = useState<Record<string, unknown> | null>(null);
    const [authStateData, setAuthStateData] = useState<Record<string, unknown> | null>(null);
    const [displayableBets, setDisplayableBets] = useState<DisplayableActiveBet[]>([]);

    const userPoints = profileData ? Number(profileData.points) : 1000;
    const fixedBetAmount = 10;
    const isProfileInitialized = !!profileData;
    const isDelegated = authStateData ? authStateData.isDelegated : false;

    // Modified to use userWallet
    // Effect for L1 Anchor Provider & Program
    useEffect(() => {
        if (userWallet && standardConnection && userAuthority) {
            const providerWallet: Wallet = {
                publicKey: userAuthority,
                signTransaction: userWallet.signTransaction,
                signAllTransactions: userWallet.signAllTransactions,
                payer: new Keypair()
            };
            const newL1Provider = new AnchorProvider(standardConnection, providerWallet, AnchorProvider.defaultOptions());
            setL1Provider(newL1Provider);
            if (idlJson) {
                const newL1Program = new Program(idlJson, newL1Provider) as Program<BsBet>;
                setL1Program(newL1Program);
                console.log("L1 Program client created.");
            }
        } else {
            setL1Provider(null);
            setL1Program(null);
        }
    }, [userWallet, standardConnection, userAuthority]);

    // --- NEW: Effect for Ephemeral Provider & Program ---
    useEffect(() => {
        if (userWallet && userAuthority) {
            if (ephemeralProviderRef.current && ephemeralProviderRef.current.connection.rpcEndpoint === MAGICBLOCK_RPC_ENDPOINT) {
                // If already initialized with the same endpoint, and program exists, do nothing
                if (ephemeralProgram) return;
            }

            console.log("Initializing Ephemeral Provider & Program for MagicBlock...");
            const ephemeralSolanaConnection = new SolanaConnection(MAGICBLOCK_RPC_ENDPOINT, "confirmed");
            const ephemeralWallet: Wallet = { // Use the connected user's wallet
                publicKey: userAuthority,
                signTransaction: userWallet.signTransaction,
                signAllTransactions: userWallet.signAllTransactions,
                payer: new Keypair()
            };
            const newEphemeralProvider = new AnchorProvider(ephemeralSolanaConnection, ephemeralWallet, AnchorProvider.defaultOptions());
            ephemeralProviderRef.current = newEphemeralProvider; // Store in ref

            const newEphemeralProgram = new Program(idlJson, newEphemeralProvider) as Program<BsBet>;
            setEphemeralProgram(newEphemeralProgram);
            console.log("Ephemeral Program client created for MagicBlock RPC.");
        } else {
            ephemeralProviderRef.current = null;
            setEphemeralProgram(null);
        }
    }, [userWallet, userAuthority, ephemeralProgram]);

    // Effect for PDA Derivation (uses L1 program, as PDAs are on L1)
    useEffect(() => {
        if (l1Program && userAuthority) {
            // ... (PDA derivation logic - same as before, uses l1Program.programId) ...
            setActionFeedbackMessage('Deriving PDAs...');
            try {
                const [profilePdaRet] = anchor.web3.PublicKey.findProgramAddressSync(
                    [Buffer.from("profile"), userAuthority.toBuffer()], l1Program.programId
                );
                setUserProfilePda(profilePdaRet);
                const [authStatePdaRet] = anchor.web3.PublicKey.findProgramAddressSync(
                    [Buffer.from("auth_state"), userAuthority.toBuffer()], l1Program.programId
                );
                setUserAuthStatePda(authStatePdaRet);
                setActionFeedbackMessage('PDAs derived.');
            } catch (error) {
                console.error("Error deriving PDAs:", error);
            }
        } else { /* ... clear PDAs ... */ }
    }, [l1Program, userAuthority, userWallet]);

    // Fetch functions use L1 program to get ground truth state
    const fetchUserProfileData = useCallback(async () => {
        if (!l1Program || !userProfilePda) return;
        try {
            const data = await l1Program.account.userProfile.fetch(userProfilePda);
            setProfileData(data);
        }
        catch (e) {
            setProfileData(null);
            console.warn("Fetch profile L1 error", e);
        }
    }, [l1Program, userProfilePda]);

    const fetchUserAuthStateData = useCallback(async () => {
        if (!l1Program || !userAuthStatePda) return;
        try {
            const data = await l1Program.account.userAuthState.fetch(userAuthStatePda);
            setAuthStateData(data);
        }
        catch (e) {
            setAuthStateData(null);
            console.warn("Fetch auth L1 error", e);
        }
    }, [l1Program, userAuthStatePda]);

    useEffect(() => { // Auto-fetch
        if (userProfilePda && l1Program) {
            fetchUserProfileData();
        }
        if (userAuthStatePda && l1Program) {
            fetchUserAuthStateData();
        }
    }, [userProfilePda, userAuthStatePda, l1Program, fetchUserProfileData, fetchUserAuthStateData]);

    const handleCreateUserProfile = useCallback(async () => {
        if (!l1Program || !userAuthority || !userProfilePda || !userAuthStatePda) return;
        setLoading(true);
        try {
            await l1Program.methods.createUserProfile().accounts({
                userProfile: userProfilePda,
                userAuthStateForProfileCreation: userAuthStatePda,
                userAuthority: userAuthority,
                systemProgram: SystemProgram.programId,
            }).rpc();
            /* ... fetch data ... */
        } catch (err) {
            console.error("Error creating user profile:", err);
        } finally {
            setLoading(false);
        }
    }, [l1Program, userAuthority, userProfilePda, userAuthStatePda, fetchUserProfileData, fetchUserAuthStateData]);

    const fetchAndDisplayActiveBets = useCallback(async () => { /* uses l1Program */
        if (!l1Program || !userAuthority) { setDisplayableBets([]); return; }
        // ... same logic using l1Program ...
    }, [l1Program, userAuthority]);

    useEffect(() => { if (l1Program && userAuthority) fetchAndDisplayActiveBets(); }, [l1Program, userAuthority, fetchAndDisplayActiveBets]);

    // MagicBlock Delegation Program ID
    const MAGICBLOCK_DELEGATION_PROGRAM_ID = new anchor.web3.PublicKey(
        process.env.NEXT_PUBLIC_MAGICBLOCK_DELEGATION_PROGRAM_ID || "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh"
    );

    const handleDelegate = async () => {
        if (!l1Program || !userAuthority || !userAuthStatePda || !userWallet?.signMessage) {
            setActionFeedbackMessage("Wallet/Program not ready for delegation.");
            setLoading(false); return;
        }

        setLoading(true);
        setActionFeedbackMessage("Checking current delegation status...");

        try {
            const authStateAccountInfo = await l1Program.provider.connection.getAccountInfo(userAuthStatePda);

            if (authStateAccountInfo) {
                // Account EXISTS. Check owner.
                if (authStateAccountInfo.owner.equals(MAGICBLOCK_DELEGATION_PROGRAM_ID)) {
                    // Already fully delegated to MagicBlock
                    setActionFeedbackMessage("Quick Bets are already enabled and managed by MagicBlock.");
                    // Ensure our client state reflects this if it's out of sync
                    if (!isDelegated) { // isDelegated is the React state based on authStateData
                        // Fetch raw data if needed to update local React state, or just assume.
                        // For simplicity, we'll just update the UI flag.
                        setAuthStateData({ ...(authStateData || {}), isDelegated: true });
                    }
                    setLoading(false);
                    return;
                } else if (authStateAccountInfo.owner.equals(l1Program.programId)) {
                    // Owned by OUR program. Try to decode OUR UserAuthState data.
                    const decodedData = l1Program.coder.accounts.decode<any>("UserAuthState", authStateAccountInfo.data);
                    const currentNonce = decodedData.nonce;
                    const alreadyBizDelegated = decodedData.isDelegated; // Our program's flag

                    if (alreadyBizDelegated) {
                        // Our program set is_delegated=true (manage_delegation step 1 done),
                        // but MB doesn't own it yet. This means delegate_auth_state (MB SDK call) needs to run.
                        setActionFeedbackMessage("Ready for MagicBlock SDK. Attempting MagicBlock delegation (Step 2)...");
                        await l1Program.methods.delegateAuthState()
                            .accounts({ payer: userAuthority, pda: userAuthStatePda } as any)
                            .rpc({ commitment: "confirmed" });
                        setActionFeedbackMessage("Successfully Enabled Quick Bets (MagicBlock SDK Confirmed)!");
                        // After this, owner has changed. fetchUserAuthStateData will fail.
                        // Optimistically update client state.
                        setAuthStateData({ ...decodedData, isDelegated: true }); // Keep existing data, update flag
                        setLoading(false);
                        return;
                    }
                    // If owned by us and not bizDelegated, proceed to full delegation flow below (sign message etc.)
                    setActionFeedbackMessage("Starting delegation process (Step 1: Sign Message)...");
                    // Fall through to sign message and call manageDelegation
                } else {
                    // Owned by some other unexpected program
                    setActionFeedbackMessage(`Error: Auth State PDA has an unexpected owner: ${authStateAccountInfo.owner.toBase58()}`);
                    setLoading(false); return;
                }
            } else {
                // UserAuthState PDA does not exist, will be created by manage_delegation
                setActionFeedbackMessage("New user for delegation. Starting process (Step 1: Sign Message)...");
                // Fall through to sign message and call manageDelegation (currentNonce will be new BN(0))
            }

            // If we are here, UserAuthState either doesn't exist or is owned by us and is_delegated is false.
            // We need to run manage_delegation (Step 1) then delegate_auth_state (Step 2).
            let currentNonceForSigning = new BN(0);
            if (authStateData && authStateAccountInfo && authStateAccountInfo.owner.equals(l1Program.programId)) {
                // If we successfully decoded our data above and it's not delegated yet
                currentNonceForSigning = authStateData.nonce || new BN(0);
            }

            const delegationMessageString = `BSBET_DELEGATE_AUTH:${userAuthority.toBase58()}:${currentNonceForSigning.toString()}`;

            setActionFeedbackMessage("Please Sign Message in Wallet (Step 1)...");

            // Use our utility function instead of calling wallet.signMessage directly
            const { signature: signatureForProgram, signatureBytes } =
                await signAndFormatMessage(userWallet, delegationMessageString);

            if (!signatureBytes || !signatureForProgram) {
                setActionFeedbackMessage("Message signing failed or was rejected");
                setLoading(false);
                return;
            }

            if (signatureForProgram.length !== 64) {
                setActionFeedbackMessage(`Invalid signature length: ${signatureForProgram.length}`);
                setLoading(false);
                return;
            }

            // Continue with the rest of the delegation process
            setActionFeedbackMessage("Processing On-chain Verification (Step 1)...");
            const messageBuffer = Buffer.from(delegationMessageString, 'utf8');

            await l1Program.methods.manageDelegation(1, messageBuffer, signatureForProgram as any)
                .accounts({
                    userAuthState: userAuthStatePda,
                    userAuthority: userAuthority,
                    systemProgram: SystemProgram.programId,
                    magicProgram: null, magicContext: null,
                    ixSysvar: anchor.web3.SYSVAR_INSTRUCTIONS_PUBKEY,
                } as any).rpc({ commitment: "confirmed" });

            setActionFeedbackMessage("Confirming Delegation with MagicBlock (Step 2)...");
            const delegateTx = await l1Program.methods.delegateAuthState()
                .accounts({ payer: userAuthority, pda: userAuthStatePda } as any)
                .rpc({ commitment: "confirmed" });

            setActionFeedbackMessage(`Successfully Enabled Quick Bets! Tx: ${delegateTx}`);
            // After delegateAuthState, owner has changed.
            // Optimistically update client state to reflect delegation.
            // A "true" fetch would require getAccountInfo and manual decode of MB's data if any.
            setAuthStateData({
                userAuthority: userAuthority, // Assume this remains conceptually
                isDelegated: true,
                delegation_timestamp: new BN(Date.now() / 1000), // Approx
                nonce: currentNonceForSigning.add(new BN(1)), // Reflect nonce increment
                bump: authStateData?.bump || 0 // Try to preserve bump if known, else default
            });

        } catch (error: any) {
            console.error("Error Enabling Quick Bets:", error);
            let errorMsg = "Failed to enable Quick Bets: ";
            if (error instanceof anchor.AnchorError) {
                errorMsg += `(${error.error.errorCode.number}) ${error.error.errorMessage}`;
            } else { errorMsg += error.message || String(error); }
            setActionFeedbackMessage(errorMsg);
        } finally {
            setLoading(false);
        }
    };

    const handleUndelegate = async () => {
        if (!l1Program || !userAuthority || !userAuthStatePda) {
            setActionFeedbackMessage("Wallet/Program not ready for disabling Quick Bets."); setLoading(false); return;
        }

        // Placeholder - these MUST be correct for the SDK call to work
        const ACTUAL_MAGIC_BLOCK_PROGRAM_ID = new PublicKey("DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh"); // This is MB's *Delegation Program* ID
        // The `magic_program` for `commit_and_undelegate` might be a different core MB program.
        // This needs to be verified from MB docs.
        const ACTUAL_MAGIC_BLOCK_CONTEXT_ACCOUNT = userAuthStatePda; // Often the context is specific or global, userAuthStatePda is unlikely to be the MB context.
        // This needs verification. For now, using a placeholder will likely fail the SDK call.

        setLoading(true); setActionFeedbackMessage("Disabling Quick Bets (Step 1: Telling MagicBlock)...");
        try {
            // Step 1: Call the new instruction to have MagicBlock return ownership
            await l1Program.methods.undelegateFromMagicblock() // New instruction name
                .accounts({
                    userAuthority: userAuthority,
                    userAuthStateToUndelegate: userAuthStatePda, // Passed as AccountInfo
                    magicProgram: ACTUAL_MAGIC_BLOCK_PROGRAM_ID, // Pass actual known MB program ID
                    magicContext: ACTUAL_MAGIC_BLOCK_CONTEXT_ACCOUNT, // Pass actual known MB context
                })
                .rpc({ commitment: "confirmed" });

            setActionFeedbackMessage("MagicBlock undelegation initiated (Step 1 complete). Finalizing state (Step 2)...");

            // Step 2: Now that ownership is (hopefully) back with our program,
            // call manageDelegation(0) to update our UserAuthState.is_delegated flag.
            const undelegateTx = await l1Program.methods.manageDelegation(0, Buffer.from([]), new Array(64).fill(0) as any)
                .accounts({
                    userAuthState: userAuthStatePda,
                    userAuthority: userAuthority,
                    systemProgram: SystemProgram.programId,
                    ixSysvar: anchor.web3.SYSVAR_INSTRUCTIONS_PUBKEY,
                    magicProgram: null,
                    magicContext: null,
                } as any)
                .rpc({ commitment: "confirmed" });

            setActionFeedbackMessage(`Successfully Disabled Quick Bets! Tx: ${undelegateTx}`);
            await fetchUserAuthStateData(); // This should now fetch Account<UserAuthState> with is_delegated = false

        } catch (error: any) {
            console.error("Error Disabling Quick Bets:", error);
            let errorMsg = "Failed to disable Quick Bets: ";
            // ... (your existing error parsing) ...
            if (error instanceof anchor.AnchorError) { errorMsg += `(${error.error.errorCode.number}) ${error.error.errorMessage}`; }
            else { errorMsg += error.message || String(error); }
            setActionFeedbackMessage(errorMsg);
            await fetchUserAuthStateData(); // Fetch to see what state it's in
        } finally {
            setLoading(false);
        }
    };

    // --- MODIFIED: Handle Bet Placement ---
    const handleBet = async (direction: "UP" | "DOWN") => { // Parameter is 'direction'
        // Determine which program client and provider to use
        const currentProgram = isDelegated && ephemeralProgram ? ephemeralProgram : l1Program;
        const currentProvider = isDelegated && ephemeralProviderRef.current ? ephemeralProviderRef.current : l1Provider;

        if (!currentProgram || !userAuthority || !userProfilePda || !userAuthStatePda || !currentProvider) {
            setActionFeedbackMessage('Wallet/Program not ready for bet.'); return;
        }
        if (isProfileInitialized && userPoints < fixedBetAmount) {
            setActionFeedbackMessage('Insufficient points.'); return;
        }
        setLoading(true); setActionFeedbackMessage(`Placing ${direction} bet...`); setFeedback(null);

        // This is where directionArg is defined based on the 'direction' parameter
        const directionArg: number = direction === "UP" ? 1 : 0;
        const assetNameArg: string = "SOL/USD";
        const amountArg = new BN(fixedBetAmount);
        const durationSecondsArg = new BN(1 * 60); // 1 minute for testing
        const betAccountKeypair = Keypair.generate();

        try {
            console.log(`Placing bet via: ${isDelegated && ephemeralProgram ? "Ephemeral RPC (MagicBlock)" : "Standard L1 RPC"}`);

            const methodsBuilder = currentProgram.methods
                .openBet( // Call to the Rust program's open_bet instruction
                    assetNameArg,
                    directionArg, // --- THIS IS THE CORRECTED VARIABLE ---
                    amountArg,
                    durationSecondsArg,
                    userAuthority // user_authority_for_pdas
                )
                .accounts({
                    betAccount: betAccountKeypair.publicKey,
                    userSigner: userAuthority,
                    userAuthState: userAuthStatePda,
                    userProfile: userProfilePda,
                    pythPriceFeed: PYTH_SOL_USD_PRICE_ACCOUNT,
                    systemProgram: SystemProgram.programId,
                } as any)
                .signers([betAccountKeypair]);

            let txSignature: string;
            if (isDelegated && ephemeralProviderRef.current && currentProgram === ephemeralProgram) {
                console.log("Sending TX via Ephemeral Provider's RPC method");
                txSignature = await methodsBuilder.rpc({ commitment: "confirmed" });
            } else {
                console.log("Sending TX via L1 Provider's RPC method");
                txSignature = await methodsBuilder.rpc({ commitment: "confirmed" });
            }

            setFeedback(`Bet ${direction} Placed!`);
            setActionFeedbackMessage(`Tx: ${txSignature} via ${isDelegated && ephemeralProgram ? "MB" : "L1"}`);
            // ... (localStorage, fetchUserProfileData, fetchAndDisplayActiveBets using l1Program) ...
            const currentBets = JSON.parse(localStorage.getItem(`activeBets_${userAuthority.toBase58()}`) || '[]');
            localStorage.setItem(`activeBets_${userAuthority.toBase58()}`, JSON.stringify([...currentBets, betAccountKeypair.publicKey.toBase58()]));
            await fetchUserProfileData(); // Assuming this uses l1Program to get ground truth
            await fetchAndDisplayActiveBets(); // Assuming this uses l1Program


        } catch (error: any) {
            console.error("Error opening bet:", error);
            let errorMsg = "Failed to place bet.";
            if (error instanceof anchor.AnchorError) {
                errorMsg = `Bet Error (${error.error.errorCode.number}): ${error.error.errorMessage}`;
                if (error.error.errorCode.number === 6015) {
                    errorMsg += " Try enabling Quick Bets or ensure profile is active.";
                }
            } else if (error.message) { errorMsg += ` ${error.message}`; }
            setFeedback(null); setActionFeedbackMessage(errorMsg);
            await fetchUserProfileData(); // Refresh points
        }
        finally { setLoading(false); }
    };

    return (
        <div className="bg-gray-900 p-6 rounded-lg shadow-lg w-full max-w-xs flex flex-col items-center justify-between h-full min-h-[350px]">
            <div className="w-full flex flex-col items-center mb-4">
                <UserProfile userPoints={userPoints} fixedBetAmount={fixedBetAmount} isProfileInitialized={isProfileInitialized} />
            </div>

            {/* --- MODIFIED: Separate Buttons for Enable/Disable Delegation --- */}
            {userWallet && userAuthority && authStateData !== undefined && ( // Show if auth state is loaded or explicitly null after fetch
                <div className="my-3 w-full">
                    {!isDelegated ? (
                        // Show "Enable Quick Bets" button if not currently delegated
                        <button
                            className="w-full px-4 py-2.5 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-500 transition-colors text-sm"
                            onClick={handleDelegate}
                            disabled={loading || !userWallet?.signMessage || !l1Program || !connected}
                        >
                            {loading && actionFeedbackMessage.includes("Enabling") ? "Enabling Quick Bets..." : "Enable Quick Bets"}
                        </button>
                    ) : (
                        // Show "Disable Quick Bets" button if currently delegated
                        <button
                            className="w-full px-4 py-2.5 bg-red-600 text-white rounded-lg font-semibold hover:bg-red-500 transition-colors text-sm"
                            onClick={handleUndelegate}
                            disabled={loading || !l1Program || !connected}
                        >
                            {loading && actionFeedbackMessage.includes("Disabling") ? "Disabling Quick Bets..." : "Disable Quick Bets"}
                        </button>
                    )}
                    <p className="text-xs text-gray-400 mt-1 text-center">
                        {isDelegated ? "Quick Bets: ON (MagicBlock Active)" : "Quick Bets: OFF (Standard Transactions)"}
                    </p>
                </div>
            )}
            {userWallet && userAuthority && authStateData === undefined && ( // Still loading initial auth state
                <div className="my-3 w-full">
                    <button className="w-full px-4 py-2.5 bg-gray-500 text-white rounded-lg font-semibold text-sm" disabled>
                        Loading Quick Bet Status...
                    </button>
                </div>
            )}
            {/* --- END MODIFIED Buttons --- */}


            {/* Bet Buttons */}
            <div className="flex flex-col gap-6 w-full flex-1 justify-center items-center">
                <button
                    className="w-full py-6 text-2xl font-bold rounded-lg bg-green-900 hover:bg-green-800 transition text-white shadow-lg mb-2"
                    style={{ minHeight: 124 }}
                    disabled={loading || !userWallet || !connected || (isProfileInitialized && userPoints < fixedBetAmount)}
                    onClick={() => handleBet("UP")}
                > <span className="mr-2">⬆️</span> UP </button>
                <button
                    className="w-full py-6 text-2xl font-bold rounded-lg bg-red-900 hover:bg-red-800 transition text-white shadow-lg"
                    style={{ minHeight: 124 }}
                    disabled={loading || !userWallet || !connected || (isProfileInitialized && userPoints < fixedBetAmount)}
                    onClick={() => handleBet("DOWN")}
                > <span className="mr-2">⬇️</span> DOWN </button>
            </div>

            {/* Feedback Area */}
            <div className="mt-4 h-6 text-center w-full">
                {loading && !feedback && <span className="text-blue-400">Processing...</span>}
                {feedback && <span className="text-green-400 font-semibold">{feedback}</span>}
                {!loading && userWallet && isProfileInitialized && userPoints < fixedBetAmount && !feedback && (
                    <span className="text-red-400">Insufficient points</span>
                )}
            </div>
            <div className="mt-1 text-xs text-gray-400 w-full text-center min-h-[2em]">
                {typeof actionFeedbackMessage === 'string'
                    ? formatActionFeedbackMessage(actionFeedbackMessage)
                    : actionFeedbackMessage}
            </div>

            {/* Initialize Profile Button */}
            {userWallet && !isProfileInitialized && userAuthority && (
                <div className="mt-3 w-full">
                    <button
                        className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-500 transition-colors text-sm"
                        onClick={handleCreateUserProfile}
                        disabled={loading || !l1Program || !userProfilePda || !userAuthStatePda || !connected}
                    >
                        {loading && actionFeedbackMessage.includes("profile") ? "Initializing..." : "Initialize Profile (1000 pts)"}
                    </button>
                </div>
            )}

            {/* Add right before the closing div of the main container */}
            <div className="w-full text-center mt-2 text-xs text-gray-500">
                {!connected && <span className="text-yellow-500">Wallet not connected. Please connect to place bets.</span>}
                {connected && !userWallet?.signMessage && <span className="text-yellow-500">Connected wallet does not support signing. Features may be limited.</span>}
            </div>
        </div>
    );
}