import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";

import { assert } from "chai";
import { BsBet } from "../target/types/bs_bet";

describe("Binary Options Program - Full Points System Flow", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.BsBet as Program<BsBet>;
  const wallet = provider.wallet;

  let userProfilePDA: anchor.web3.PublicKey;
  let userProfileBump: number;

  const solUsdPythPriceFeedDevnet = new anchor.web3.PublicKey(
    "7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE"
  );
  const initialPoints = new anchor.BN(1000);

  before(async () => {
    [userProfilePDA, userProfileBump] =
      await anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("profile"), wallet.publicKey.toBuffer()],
        program.programId
      );
    console.log(`UserProfile PDA for wallet ${wallet.publicKey.toBase58()}: ${userProfilePDA.toBase58()}`);

    // Ensure profile is created fresh or reset for a clean test run
    console.log("Ensuring fresh user profile with initial points for test suite...");
    try {
      await program.methods
        .createUserProfile()
        .accounts({
          userProfile: userProfilePDA,
          userAuthority: wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc({ skipPreflight: true });
      const profile = await program.account.userProfile.fetch(userProfilePDA);
      console.log(`UserProfile created/accessed with ${profile.points.toString()} points. Bump: ${profile.bump}`);
      assert.ok(profile.points.eq(initialPoints), "Profile should have initial points for test suite start.");

    } catch (e) {
      console.error("Failed to ensure fresh user profile in beforeAll:", e);
      throw e;
    }
  });

  it("1. Opens a new bet using user points", async () => {
    // ... (Test 2 from your "Full Flow with Points" - it's good)
    console.log("Test 1: Attempting to open a new bet with points...");
    const betAccountKp = anchor.web3.Keypair.generate();
    const assetName = "SOL/USD";
    const direction = 1; // UP
    const betAmountPoints = new anchor.BN(100);
    const durationSeconds = new anchor.BN(60 * 1); // 1 minute for this test

    const profileBeforeBet = await program.account.userProfile.fetch(userProfilePDA);
    const pointsBeforeBet = profileBeforeBet.points;
    console.log(`Points before opening bet: ${pointsBeforeBet.toString()}`);

    assert.ok(pointsBeforeBet.gte(betAmountPoints), "Insufficient points to place bet for test setup.");

    await program.methods
      .openBet(assetName, direction, betAmountPoints, durationSeconds)
      .accounts({
        betAccount: betAccountKp.publicKey,
        userSigner: wallet.publicKey,
        userProfile: userProfilePDA,
        pythPriceFeed: solUsdPythPriceFeedDevnet,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([betAccountKp])
      .rpc({ skipPreflight: true });

    console.log(`Bet opened successfully! Bet Account: ${betAccountKp.publicKey.toBase58()}`);
    const profileAfterBet = await program.account.userProfile.fetch(userProfilePDA);
    const expectedPointsAfterBet = pointsBeforeBet.sub(betAmountPoints);
    assert.ok(profileAfterBet.points.eq(expectedPointsAfterBet), `Points deduction failed. Expected ${expectedPointsAfterBet}, got ${profileAfterBet.points}`);
    console.log(`Points after opening bet: ${profileAfterBet.points.toString()}`);
    // ... other assertions for createdBet ...
  });

  it("2. Fails to open a bet with insufficient points", async () => {
    console.log("Test 2: Attempting to open bet with insufficient points...");
    const betAccountKp = anchor.web3.Keypair.generate();
    const assetName = "SOL/USD";
    const direction = 0; // DOWN

    // Fetch current points
    const profileData = await program.account.userProfile.fetch(userProfilePDA);
    console.log(`Current points for profile ${userProfilePDA.toBase58()}: ${profileData.points.toString()}`);

    // This is the amount that *should* trigger InsufficientPoints
    const amountToBetThatIsTooHigh = profileData.points.add(new anchor.BN(1));
    console.log(`Attempting to bet an amount that is too high: ${amountToBetThatIsTooHigh.toString()}`);

    const durationSeconds = new anchor.BN(60);

    try {
      console.log("Test 2: Preparing to call openBet with excessive amount...");
      await program.methods
        .openBet(assetName, direction, amountToBetThatIsTooHigh, durationSeconds) // Using the amount that should fail
        .accounts({
          betAccount: betAccountKp.publicKey,
          userSigner: wallet.publicKey,
          userProfile: userProfilePDA,
          pythPriceFeed: solUsdPythPriceFeedDevnet,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([betAccountKp])
        .rpc({ skipPreflight: false }); // Changed to skipPreflight: false for more RPC checks

      assert.fail("Bet opening should have failed due to insufficient points.");

    } catch (error: any) {
      // --- Keep the detailed error logging from before ---
      console.log("--- Test 2: Raw Error Object ---");
      console.log("error:", error);
      console.log("error.name:", error.name);
      console.log("error.message:", error.message);
      console.log("error.stack:", error.stack);
      if (error.error) {
        console.log("error.error (Anchor specific):", error.error);
        if (error.error.errorCode) {
          console.log("error.error.errorCode.code:", error.error.errorCode.code);
          console.log("error.error.errorCode.number:", error.error.errorCode.number);
        }
        console.log("error.error.errorMessage:", error.error.errorMessage);
      }
      if (error.logs) {
        console.log("error.logs:", error.logs.join('\n'));
      }
      console.log("--- End Test 2: Raw Error Object ---");

      const expectedErrorMessageSubstring = "User does not have enough points for this bet.";
      const expectedErrorCodeString = "InsufficientPoints";
      const expectedRawErrorCode = "0x1779";

      let foundError = false;
      if (error.message && error.message.includes(expectedErrorMessageSubstring)) { foundError = true; }
      else if (error.message && error.message.includes(expectedRawErrorCode)) { foundError = true; }
      else if (error.error && error.error.errorCode && error.error.errorCode.code === expectedErrorCodeString) { foundError = true; }
      else if (error.toString().includes(expectedErrorMessageSubstring)) { foundError = true; }

      assert.isTrue(foundError, `The error thrown was not 'InsufficientPoints'. Captured error message: '${error.message}'`);
    }
  });

  it("3. Successfully resolves an expired bet and updates points", async () => {
    console.log("Test 3: Attempting to resolve a bet and update points...");
    let profile = await program.account.userProfile.fetch(userProfilePDA);
    const pointsBeforeOpeningResolveTestBet = profile.points;

    const resolveTestBetKp = anchor.web3.Keypair.generate();
    const betAmountForResolve = new anchor.BN(Math.min(50, pointsBeforeOpeningResolveTestBet.toNumber())); // Bet 50 or available points
    if (betAmountForResolve.lten(0)) {
      console.log("Skipping resolve test as user has no points to make a bet.");
      return; // Skip test if no points
    }

    const assetForResolve = "SOL/USD";
    const directionForResolve = 1; // Bet UP
    const shortDuration = new anchor.BN(15);

    console.log(`Opening bet for resolution: Amount=${betAmountForResolve}, UserPointsBeforeThisBet=${pointsBeforeOpeningResolveTestBet}`);
    await program.methods
      .openBet(assetForResolve, directionForResolve, betAmountForResolve, shortDuration)
      .accounts({
        betAccount: resolveTestBetKp.publicKey, // Ensure this line is correct
        userSigner: wallet.publicKey,          // Ensure this line is correct
        userProfile: userProfilePDA,
        pythPriceFeed: solUsdPythPriceFeedDevnet,
        systemProgram: anchor.web3.SystemProgram.programId, // <<< CORRECTED
      })
      .signers([resolveTestBetKp])
      .rpc({ skipPreflight: true });

    const profileAfterOpeningBetForResolve = await program.account.userProfile.fetch(userProfilePDA);
    console.log(`Points after opening bet for resolve: ${profileAfterOpeningBetForResolve.points.toString()}`);

    console.log(`Waiting ${shortDuration.toNumber() + 5} seconds for bet to expire...`);
    await new Promise(resolve => setTimeout(resolve, (shortDuration.toNumber() + 5) * 1000));

    await program.methods
      .resolveBet()
      .accounts({
        betAccount: resolveTestBetKp.publicKey,
        user: wallet.publicKey,
        userProfile: userProfilePDA,
        pythPriceFeed: solUsdPythPriceFeedDevnet,
        clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
      })
      .rpc({ skipPreflight: true });

    const resolvedBet = await program.account.activeBet.fetch(resolveTestBetKp.publicKey);
    const profileAfterResolve = await program.account.userProfile.fetch(userProfilePDA);
    // ... (rest of your assertions for points update based on win/loss) ...
    console.log(`Bet resolved! Status: ${resolvedBet.status}, Final Points: ${profileAfterResolve.points.toString()}`);
    assert.oneOf(resolvedBet.status, [1, 2], "Bet status should be ResolvedWon or ResolvedLost");
    if (resolvedBet.status === 1) { // Won
      const expectedPointsOnWin = profileAfterOpeningBetForResolve.points.add(betAmountForResolve.mul(new anchor.BN(2)));
      assert.ok(profileAfterResolve.points.eq(expectedPointsOnWin), `Points mismatch on WIN. Expected ${expectedPointsOnWin}, got ${profileAfterResolve.points}`);
    } else { // Lost
      const expectedPointsOnLoss = profileAfterOpeningBetForResolve.points;
      assert.ok(profileAfterResolve.points.eq(expectedPointsOnLoss), `Points mismatch on LOSS. Expected ${expectedPointsOnLoss}, got ${profileAfterResolve.points}`);
    }
  });


});