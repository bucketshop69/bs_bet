import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, Keypair } from "@solana/web3.js";
import { assert } from "chai";
import { BsBet } from "../target/types/bs_bet";

describe("bs_bet", () => {
  // Configure the client to use the local cluster
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.BsBet as Program<BsBet>;
  const wallet = provider.wallet as anchor.Wallet;

  // Constants
  const INITIAL_POINTS = new anchor.BN(1000);
  const BET_AMOUNT = new anchor.BN(100);
  const DURATION_SECONDS = new anchor.BN(3600); // 1 hour

  describe("1. User Profile Initialization", () => {
    let userProfilePda: PublicKey;

    before(async () => {
      // Derive PDA for user profile
      [userProfilePda] = await PublicKey.findProgramAddress(
        [Buffer.from("profile"), wallet.publicKey.toBuffer()],
        program.programId
      );
    });

    it("creates a new user profile with initial points", async () => {
      // Create user profile
      await program.methods.createUserProfile()
        .accounts({
          user_profile: userProfilePda,
          user_authority: wallet.publicKey,
          system_program: SystemProgram.programId,
        })
        .rpc();

      // Fetch the created profile
      const profile = await program.account.userProfile.fetch(userProfilePda);

      // Verify profile data
      assert.ok(profile.authority.equals(wallet.publicKey), "Profile authority should match wallet");
      assert.ok(profile.points.eq(INITIAL_POINTS), "Profile should have initial points");
      assert.isNumber(profile.bump, "Profile should have a bump seed");
    });

    it("does not reinitialize points when called twice", async () => {
      // Get current profile state
      const profileBefore = await program.account.userProfile.fetch(userProfilePda);
      const pointsBefore = profileBefore.points;

      // Call create_user_profile again
      await program.methods.createUserProfile()
        .accounts({
          user_profile: userProfilePda,
          user_authority: wallet.publicKey,
          system_program: SystemProgram.programId,
        })
        .rpc();

      // Fetch profile again
      const profileAfter = await program.account.userProfile.fetch(userProfilePda);

      // Verify points haven't changed
      assert.ok(profileAfter.points.eq(pointsBefore), "Points should not be reinitialized");
      assert.ok(profileAfter.authority.equals(wallet.publicKey), "Authority should remain the same");
    });

    it("verifies profile authority matches signer", async () => {
      const profile = await program.account.userProfile.fetch(userProfilePda);

      // Verify authority matches the wallet that created it
      assert.ok(
        profile.authority.equals(wallet.publicKey),
        "Profile authority should match the signer's public key"
      );
    });
  });

  describe("2. Bet Opening", () => {
    let userProfilePda: PublicKey;
    let userAuthStatePda: PublicKey;
    let betAccount: Keypair;
    let pythPriceFeed: PublicKey;

    before(async () => {
      // Derive PDAs
      [userProfilePda] = await PublicKey.findProgramAddress(
        [Buffer.from("profile"), wallet.publicKey.toBuffer()],
        program.programId
      );
      [userAuthStatePda] = await PublicKey.findProgramAddress(
        [Buffer.from("auth_state"), wallet.publicKey.toBuffer()],
        program.programId
      );

      // Create user profile if it doesn't exist
      try {
        await program.methods.createUserProfile()
          .accounts({
            user_profile: userProfilePda,
            user_authority: wallet.publicKey,
            system_program: SystemProgram.programId,
          })
          .rpc();
      } catch (e) {
        // Profile might already exist, which is fine
      }

      // Initialize auth state
      try {
        await program.methods.manageDelegation(
          1, // delegation_action = 1 for verify signature and prepare for delegation
          Buffer.from("BSBET_DELEGATE_AUTH:" + wallet.publicKey.toBase58() + ":0"), // user_signed_message
          new Uint8Array(64) // signature (empty for testing)
        )
          .accounts({
            user_auth_state: userAuthStatePda,
            user_authority: wallet.publicKey,
            system_program: SystemProgram.programId,
            magic_program: null,
            magic_context: null,
            ix_sysvar: anchor.web3.SYSVAR_INSTRUCTIONS_PUBKEY,
            ed25519_program: anchor.web3.ED25519_PROGRAM_ID,
          })
          .rpc();
      } catch (e) {
        // Auth state might already be initialized, which is fine
      }

      // Get Pyth price feed address
      pythPriceFeed = new PublicKey("7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE");
    });

    it("opens a UP bet with valid parameters", async () => {
      // Generate a new keypair for the bet account
      betAccount = Keypair.generate();

      // Open UP bet (direction = 1)
      await program.methods.openBet(
        "SOL/USD",
        1, // UP direction
        BET_AMOUNT,
        DURATION_SECONDS,
        wallet.publicKey
      )
        .accounts({
          betAccount: betAccount.publicKey,
          userSigner: wallet.publicKey,
          userAuthState: userAuthStatePda,
          user_profile: userProfilePda,
          pythPriceFeed: pythPriceFeed,
          systemProgram: SystemProgram.programId,
        })
        .signers([betAccount])
        .rpc();

      // Fetch the created bet
      const bet = await program.account.activeBet.fetch(betAccount.publicKey);

      // Verify bet data
      assert.ok(bet.user.equals(wallet.publicKey), "Bet user should match wallet");
      assert.equal(bet.assetName, "SOL/USD", "Asset name should be SOL/USD");
      assert.equal(bet.direction, 1, "Direction should be UP (1)");
      assert.ok(bet.amountStaked.eq(BET_AMOUNT), "Amount staked should match");
      assert.ok(bet.status.eq(new anchor.BN(0)), "Status should be active (0)");
    });

    it("opens a DOWN bet with valid parameters", async () => {
      // Generate a new keypair for the bet account
      betAccount = Keypair.generate();

      // Open DOWN bet (direction = 0)
      await program.methods.openBet(
        "SOL/USD",
        0, // DOWN direction
        BET_AMOUNT,
        DURATION_SECONDS,
        wallet.publicKey
      )
        .accounts({
          betAccount: betAccount.publicKey,
          userSigner: wallet.publicKey,
          userAuthState: userAuthStatePda,
          user_profile: userProfilePda,
          pythPriceFeed: pythPriceFeed,
          systemProgram: SystemProgram.programId,
        })
        .signers([betAccount])
        .rpc();

      // Fetch the created bet
      const bet = await program.account.activeBet.fetch(betAccount.publicKey);

      // Verify bet data
      assert.ok(bet.user.equals(wallet.publicKey), "Bet user should match wallet");
      assert.equal(bet.assetName, "SOL/USD", "Asset name should be SOL/USD");
      assert.equal(bet.direction, 0, "Direction should be DOWN (0)");
      assert.ok(bet.amountStaked.eq(BET_AMOUNT), "Amount staked should match");
      assert.ok(bet.status.eq(new anchor.BN(0)), "Status should be active (0)");
    });

    it("fails with unsupported asset", async () => {
      betAccount = Keypair.generate();

      try {
        await program.methods.openBet(
          "BTC/USD", // Unsupported asset
          1,
          BET_AMOUNT,
          DURATION_SECONDS,
          wallet.publicKey
        )
          .accounts({
            betAccount: betAccount.publicKey,
            userSigner: wallet.publicKey,
            userAuthState: userAuthStatePda,
            user_profile: userProfilePda,
            pythPriceFeed: pythPriceFeed,
            systemProgram: SystemProgram.programId,
          })
          .signers([betAccount])
          .rpc();
        assert.fail("Should have thrown an error for unsupported asset");
      } catch (e) {
        assert.include(e.message, "UnsupportedAsset");
      }
    });

    it("fails with invalid direction", async () => {
      betAccount = Keypair.generate();

      try {
        await program.methods.openBet(
          "SOL/USD",
          2, // Invalid direction (must be 0 or 1)
          BET_AMOUNT,
          DURATION_SECONDS,
          wallet.publicKey
        )
          .accounts({
            betAccount: betAccount.publicKey,
            userSigner: wallet.publicKey,
            userAuthState: userAuthStatePda,
            user_profile: userProfilePda,
            pythPriceFeed: pythPriceFeed,
            systemProgram: SystemProgram.programId,
          })
          .signers([betAccount])
          .rpc();
        assert.fail("Should have thrown an error for invalid direction");
      } catch (e) {
        assert.include(e.message, "InvalidDirection");
      }
    });

    it("fails with zero amount", async () => {
      betAccount = Keypair.generate();

      try {
        await program.methods.openBet(
          "SOL/USD",
          1,
          new anchor.BN(0), // Zero amount
          DURATION_SECONDS,
          wallet.publicKey
        )
          .accounts({
            betAccount: betAccount.publicKey,
            userSigner: wallet.publicKey,
            userAuthState: userAuthStatePda,
            user_profile: userProfilePda,
            pythPriceFeed: pythPriceFeed,
            systemProgram: SystemProgram.programId,
          })
          .signers([betAccount])
          .rpc();
        assert.fail("Should have thrown an error for zero amount");
      } catch (e) {
        assert.include(e.message, "ZeroAmount");
      }
    });

    it("fails with invalid duration", async () => {
      betAccount = Keypair.generate();

      try {
        await program.methods.openBet(
          "SOL/USD",
          1,
          BET_AMOUNT,
          new anchor.BN(0), // Invalid duration (must be positive)
          wallet.publicKey
        )
          .accounts({
            betAccount: betAccount.publicKey,
            userSigner: wallet.publicKey,
            userAuthState: userAuthStatePda,
            user_profile: userProfilePda,
            pythPriceFeed: pythPriceFeed,
            systemProgram: SystemProgram.programId,
          })
          .signers([betAccount])
          .rpc();
        assert.fail("Should have thrown an error for invalid duration");
      } catch (e) {
        assert.include(e.message, "InvalidDuration");
      }
    });

    it("fails with insufficient points", async () => {
      betAccount = Keypair.generate();

      try {
        await program.methods.openBet(
          "SOL/USD",
          1,
          new anchor.BN(2000), // More than initial points
          DURATION_SECONDS,
          wallet.publicKey
        )
          .accounts({
            betAccount: betAccount.publicKey,
            userSigner: wallet.publicKey,
            userAuthState: userAuthStatePda,
            user_profile: userProfilePda,
            pythPriceFeed: pythPriceFeed,
            systemProgram: SystemProgram.programId,
          })
          .signers([betAccount])
          .rpc();
        assert.fail("Should have thrown an error for insufficient points");
      } catch (e) {
        assert.include(e.message, "InsufficientPoints");
      }
    });
  });

  describe("3. Bet Resolution", () => {
    let userProfilePda: PublicKey;
    let userAuthStatePda: PublicKey;
    let betAccount: Keypair;
    let pythPriceFeed: PublicKey;

    before(async () => {
      // Derive PDAs
      [userProfilePda] = await PublicKey.findProgramAddress(
        [Buffer.from("profile"), wallet.publicKey.toBuffer()],
        program.programId
      );
      [userAuthStatePda] = await PublicKey.findProgramAddress(
        [Buffer.from("auth_state"), wallet.publicKey.toBuffer()],
        program.programId
      );

      // Create user profile if it doesn't exist
      try {
        await program.methods.createUserProfile()
          .accounts({
            user_profile: userProfilePda,
            user_authority: wallet.publicKey,
            system_program: SystemProgram.programId,
          })
          .rpc();
      } catch (e) {
        // Profile might already exist, which is fine
      }

      // Initialize auth state
      try {
        await program.methods.manageDelegation(
          1, // delegation_action = 1 for verify signature and prepare for delegation
          Buffer.from("BSBET_DELEGATE_AUTH:" + wallet.publicKey.toBase58() + ":0"), // user_signed_message
          new Uint8Array(64) // signature (empty for testing)
        )
          .accounts({
            user_auth_state: userAuthStatePda,
            user_authority: wallet.publicKey,
            system_program: SystemProgram.programId,
            magic_program: null,
            magic_context: null,
            ix_sysvar: anchor.web3.SYSVAR_INSTRUCTIONS_PUBKEY,
            ed25519_program: anchor.web3.ED25519_PROGRAM_ID,
          })
          .rpc();
      } catch (e) {
        // Auth state might already be initialized, which is fine
      }

      // Get Pyth price feed address
      pythPriceFeed = new PublicKey("7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE");
    });

    it("resolves a winning UP bet correctly", async () => {
      // Generate a new keypair for the bet account
      betAccount = Keypair.generate();

      // Open UP bet
      await program.methods.openBet(
        "SOL/USD",
        1, // UP direction
        BET_AMOUNT,
        DURATION_SECONDS,
        wallet.publicKey
      )
        .accounts({
          betAccount: betAccount.publicKey,
          userSigner: wallet.publicKey,
          userAuthState: userAuthStatePda,
          user_profile: userProfilePda,
          pythPriceFeed: pythPriceFeed,
          systemProgram: SystemProgram.programId,
        })
        .signers([betAccount])
        .rpc();

      // Get initial profile state
      const profileBefore = await program.account.userProfile.fetch(userProfilePda);
      const pointsBefore = new anchor.BN(profileBefore.points);

      // Wait for bet to expire
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second

      // Resolve the bet
      await program.methods.resolveBet()
        .accounts({
          betAccount: betAccount.publicKey,
          resolverSigner: wallet.publicKey,
          userAuthState: userAuthStatePda,
          user_profile: userProfilePda,
          pythPriceFeed: pythPriceFeed,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      // Fetch the resolved bet
      const bet = await program.account.activeBet.fetch(betAccount.publicKey);
      const profileAfter = await program.account.userProfile.fetch(userProfilePda);
      const pointsAfter = new anchor.BN(profileAfter.points);

      // Verify bet was resolved
      assert.ok(bet.status === 1 || bet.status === 2, "Bet should be resolved");
      assert.ok(bet.resolvedPrice > 0, "Resolved price should be set");

      // If bet was won (status 1), verify points were doubled
      if (bet.status === 1) {
        assert.ok(pointsAfter.eq(pointsBefore.add(BET_AMOUNT)), "Points should be doubled for winning bet");
      } else {
        assert.ok(pointsAfter.eq(pointsBefore), "Points should remain unchanged for losing bet");
      }
    });

    it("fails to resolve an active bet before expiry", async () => {
      // Generate a new keypair for the bet account
      betAccount = Keypair.generate();

      // Open a bet with longer duration
      await program.methods.openBet(
        "SOL/USD",
        1,
        BET_AMOUNT,
        new anchor.BN(3600), // 1 hour duration
        wallet.publicKey
      )
        .accounts({
          betAccount: betAccount.publicKey,
          userSigner: wallet.publicKey,
          userAuthState: userAuthStatePda,
          user_profile: userProfilePda,
          pythPriceFeed: pythPriceFeed,
          systemProgram: SystemProgram.programId,
        })
        .signers([betAccount])
        .rpc();

      try {
        // Try to resolve immediately
        await program.methods.resolveBet()
          .accounts({
            betAccount: betAccount.publicKey,
            resolverSigner: wallet.publicKey,
            userAuthState: userAuthStatePda,
            user_profile: userProfilePda,
            pythPriceFeed: pythPriceFeed,
            clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        assert.fail("Should have thrown an error for premature resolution");
      } catch (e) {
        assert.include(e.message, "BetNotYetExpired");
      }
    });

    it("fails to resolve an already resolved bet", async () => {
      // Generate a new keypair for the bet account
      betAccount = Keypair.generate();

      // Open a bet with short duration
      await program.methods.openBet(
        "SOL/USD",
        1,
        BET_AMOUNT,
        new anchor.BN(1), // 1 second duration
        wallet.publicKey
      )
        .accounts({
          betAccount: betAccount.publicKey,
          userSigner: wallet.publicKey,
          userAuthState: userAuthStatePda,
          user_profile: userProfilePda,
          pythPriceFeed: pythPriceFeed,
          systemProgram: SystemProgram.programId,
        })
        .signers([betAccount])
        .rpc();

      // Wait for bet to expire
      await new Promise(resolve => setTimeout(resolve, 1000));

      // First resolution
      await program.methods.resolveBet()
        .accounts({
          betAccount: betAccount.publicKey,
          resolverSigner: wallet.publicKey,
          userAuthState: userAuthStatePda,
          user_profile: userProfilePda,
          pythPriceFeed: pythPriceFeed,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      try {
        // Try to resolve again
        await program.methods.resolveBet()
          .accounts({
            betAccount: betAccount.publicKey,
            resolverSigner: wallet.publicKey,
            userAuthState: userAuthStatePda,
            user_profile: userProfilePda,
            pythPriceFeed: pythPriceFeed,
            clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        assert.fail("Should have thrown an error for double resolution");
      } catch (e) {
        assert.include(e.message, "BetNotActiveOrAlreadyResolved");
      }
    });
  });
});
