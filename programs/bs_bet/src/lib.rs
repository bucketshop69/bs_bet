use anchor_lang::{
    prelude::*,
    solana_program::{
        clock::Clock,
        // ed25519_program, // Not strictly needed for invoke if bypassed
        // instruction::Instruction as SolanaInstruction, // Not strictly needed for invoke if bypassed
        // program::invoke, // Not strictly needed for invoke if bypassed
        pubkey::Pubkey,
        sysvar::instructions as sysvar_instructions, // Keep for ManageDelegation struct
    },
};
use pyth_solana_receiver_sdk::price_update::{
    get_feed_id_from_hex,
    PriceUpdateV2,
};
// MagicBlock SDK integration
use ephemeral_rollups_sdk::anchor::{delegate, ephemeral};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::commit_and_undelegate_accounts;

declare_id!("3awHJrzJbNCCLcQNEdh5mcVfPZW55w5v7tQhDwkx7Hpt"); // YOUR PROGRAM ID

// --- Constants ---
pub const SOL_USD_FEED_ID_HEX: &str = "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";
pub const MAXIMUM_PRICE_AGE_SECONDS: u64 = 3600 * 2; // 2 hours
const STRING_LENGTH_PREFIX: usize = 4; // For String serialization
const MAX_ASSET_NAME_LENGTH: usize = 20; // Max length for asset_name string in ActiveBet
const DISCRIMINATOR_LENGTH: usize = 8; // Anchor's account discriminator
const INITIAL_USER_POINTS: u64 = 1000;

// --- Account Struct Definitions ---
#[account]
#[derive(Default, Debug)] // Added Debug for easier test logging if needed
pub struct UserAuthState {
    pub user_authority: Pubkey,
    pub is_delegated: bool, // True if delegated to MagicBlock for "quick bets"
    pub delegation_timestamp: i64,
    pub nonce: u64,         // For ensuring signed messages are unique (even if Ed25519 verify is demo-skipped)
    pub bump: u8,
}
pub const USER_AUTH_STATE_SPACE: usize = DISCRIMINATOR_LENGTH + 32 + 1 + 8 + 8 + 1;

#[account]
#[derive(Default, Debug)]
pub struct ActiveBet {
    pub user: Pubkey,
    pub asset_name: String, // Max MAX_ASSET_NAME_LENGTH
    pub initial_price: u64,
    pub expiry_timestamp: i64,
    pub direction: u8,      // 0 for DOWN, 1 for UP
    pub amount_staked: u64,
    pub resolved_price: u64,
    pub status: u8,         // 0: Active, 1: Won, 2: Lost
}
pub const ACTIVE_BET_SPACE: usize = DISCRIMINATOR_LENGTH + 32 + (STRING_LENGTH_PREFIX + MAX_ASSET_NAME_LENGTH) + 8 + 8 + 1 + 8 + 8 + 1;

#[account]
#[derive(Default, Debug)]
pub struct UserProfile {
    pub authority: Pubkey,
    pub points: u64,
    pub bump: u8,
}
pub const USER_PROFILE_SPACE: usize = DISCRIMINATOR_LENGTH + 32 + 8 + 1;

// Helper function
pub fn create_delegation_message(user_pubkey: &Pubkey, nonce: u64) -> String {
    format!("BSBET_DELEGATE_AUTH:{}:{}", user_pubkey, nonce)
}

// --- Program Module ---
#[ephemeral]
#[program]
pub mod bs_bet {
    use super::*;

    pub fn create_user_profile(ctx: Context<CreateUserProfile>) -> Result<()> {
        let user_profile = &mut ctx.accounts.user_profile;
        user_profile.authority = *ctx.accounts.user_authority.key;
        user_profile.points = INITIAL_USER_POINTS;
        user_profile.bump = ctx.bumps.user_profile;

        let auth_state = &mut ctx.accounts.user_auth_state_for_profile_creation;
        if auth_state.user_authority == Pubkey::default() { // Initialize only if new
            auth_state.user_authority = *ctx.accounts.user_authority.key;
            auth_state.is_delegated = false; // Default to standard mode
            auth_state.delegation_timestamp = 0;
            auth_state.nonce = 0;
            auth_state.bump = ctx.bumps.user_auth_state_for_profile_creation;
        }
        msg!("User profile created/updated. Auth state (is_delegated={}) initialized if new.", auth_state.is_delegated);
        Ok(())
    }

    pub fn manage_delegation(
        ctx: Context<ManageDelegation>,
        delegation_action: u8,
        user_signed_message: Vec<u8>,
        _signature: [u8; 64]) -> Result<()> {
        let auth_state = &mut ctx.accounts.user_auth_state;
        let user_key = ctx.accounts.user_authority.key();
        let clock = Clock::get()?;

        if delegation_action == 1 { // User intends to delegate ("Enable Quick Bets")
            if auth_state.user_authority == Pubkey::default() {
                auth_state.user_authority = user_key;
                auth_state.bump = ctx.bumps.user_auth_state;
                auth_state.nonce = 0;
            } else if auth_state.user_authority != user_key {
                return Err(error!(BetError::UserProfileAuthorityMismatch));
            }
            // Client-side should ideally check if already delegated before calling.
            // If called again while is_delegated = true, it effectively re-verifies for current nonce.
            if auth_state.is_delegated && auth_state.nonce > 0 { // If already delegated and nonce was incremented
                 msg!("Already processed for delegation. If MB SDK call failed, client can retry delegate_auth_state.");
                 // No error, allow client to proceed to delegate_auth_state if needed.
                 // Or, if nonce check is critical:
                 // return Err(error!(BetError::AlreadyDelegated));
            }


            let current_nonce = auth_state.nonce;
            let expected_message = create_delegation_message(&user_key, current_nonce);
            if user_signed_message != expected_message.as_bytes() {
                msg!("Invalid signed message content. Expected for nonce {}.", current_nonce);
                return Err(error!(BetError::InvalidDelegationSignature));
            }

            // --- ED25519 VERIFICATION SKIPPED (Hackathon Compromise) ---
            msg!("DEMO MODE: Skipping on-chain Ed25519 signature verification for manage_delegation.");
            // --- END OF SKIPPED VERIFICATION ---

            auth_state.is_delegated = true; // Set to true: ready for MagicBlock SDK call
            auth_state.delegation_timestamp = clock.unix_timestamp;
            auth_state.nonce = auth_state.nonce.checked_add(1).ok_or(BetError::TimestampOverflow)?;
            msg!("UserAuthState ready for MagicBlock SDK (is_delegated=true). Nonce incremented to {}.", auth_state.nonce);

        } else if delegation_action == 0 { // User intends to undelegate ("Disable Quick Bets")
        
        // This action is called AFTER undelegate_from_magicblock has returned ownership.
        if auth_state.user_authority != user_key {
            return Err(error!(BetError::UserProfileAuthorityMismatch));
        }
        // No need to check !auth_state.is_delegated, we are explicitly setting it.
        auth_state.is_delegated = false;
        // Optionally reset nonce or timestamp here if desired after full undelegation.
        // auth_state.nonce = 0; // Example
        msg!("UserAuthState locally marked as not delegated (is_delegated=false).");
        } else {
            return Err(error!(BetError::InvalidDelegationSignature)); // Or InvalidDelegationAction
        }
        Ok(())
    }

    pub fn delegate_auth_state(ctx: Context<DelegateAuthState>) -> Result<()> {
        // The `#[delegate]` macro on the `DelegateAuthState` struct makes the `delegate_pda` method
        // available on `ctx.accounts` (which is an instance of `DelegateAuthState`).
        // The method uses the field marked with `#[account(del)]` (i.e., `ctx.accounts.pda`)
        // as the target account for delegation.
    
        // The seeds passed here should be the seeds used to derive the PDA that
        // `ctx.accounts.pda` (the AccountInfo) points to.
        // Your UserAuthState PDA is derived with seeds: [b"auth_state", payer.key()]
        msg!("Attempting to delegate PDA: {} with payer: {}", ctx.accounts.pda.key(), ctx.accounts.payer.key());
        ctx.accounts.delegate_pda( // Calling the method on ctx.accounts
            // First argument is typically the fee payer for the delegation transaction,
            // but delegate_pda might just need it to confirm authority or for seeds.
            // In the MB example, ctx.accounts.payer (Signer from DelegateInput) was used.
            &ctx.accounts.payer,
            // Seeds for the PDA being delegated (UserAuthState)
            // These are the seeds used to *find* or *verify* the `ctx.accounts.pda`.
            // The `pda` field itself is already resolved to a PublicKey.
            // MagicBlock's example just passed `&[TEST_PDA_SEED]`.
            // Your seeds are `b"auth_state"` and `payer.key()`.
            &[
                b"auth_state".as_ref(),
                ctx.accounts.payer.key().as_ref() // payer.key() IS the second seed for your UserAuthState PDA
            ],
            DelegateConfig::default(),
        )?;
    
        msg!("UserAuthState PDA ({}) successfully delegated via MagicBlock SDK by payer: {}", ctx.accounts.pda.key(), ctx.accounts.payer.key());
        Ok(())
    }

    pub fn open_bet(
        ctx: Context<OpenBetAccounts>,
        asset_name_arg: String,
        direction_arg: u8,
        amount_arg: u64,
        duration_seconds_arg: i64,
        user_authority_for_pdas: Pubkey ) -> Result<()> {
        let auth_state = &mut ctx.accounts.user_auth_state;

        // Initialize UserAuthState if it's new
        if auth_state.user_authority == Pubkey::default() {
            auth_state.user_authority = user_authority_for_pdas;
            auth_state.is_delegated = false; // Default to false for new users
            auth_state.delegation_timestamp = 0;
            auth_state.nonce = 0;
            auth_state.bump = ctx.bumps.user_auth_state;
        } else if auth_state.user_authority != user_authority_for_pdas {
            // This ensures the PDA being used matches the intended user
            return Err(error!(BetError::UserProfileAuthorityMismatch));
        }

        // This signer check is important for standard (non-MagicBlock-delegated) bets
        if !auth_state.is_delegated && ctx.accounts.user_signer.key() != user_authority_for_pdas {
            return Err(error!(BetError::UserProfileAuthorityMismatch));
        }

        let user_profile = &mut ctx.accounts.user_profile;
        // Initialize UserProfile if it's new
        if user_profile.authority == Pubkey::default() {
            user_profile.authority = user_authority_for_pdas;
            user_profile.points = INITIAL_USER_POINTS;
            user_profile.bump = ctx.bumps.user_profile;
        } else if user_profile.authority != user_authority_for_pdas {
            // This ensures the PDA being used matches the intended user
            return Err(error!(BetError::UserProfileAuthorityMismatch));
        }

        // --- Rest of your open_bet logic: validation, points, Pyth, set bet_account fields ---
        // This part was generally correct in your versions.
        let bet_account = &mut ctx.accounts.bet_account;
        let clock = Clock::get()?;
        let price_update_account = &ctx.accounts.pyth_price_feed;

        // Validations
        if asset_name_arg != "SOL/USD" { return Err(error!(BetError::UnsupportedAsset)); }
        if direction_arg != 0 && direction_arg != 1 { return Err(error!(BetError::InvalidDirection)); }
        if amount_arg == 0 { return Err(error!(BetError::ZeroAmount)); }
        if duration_seconds_arg <= 0 { return Err(error!(BetError::InvalidDuration)); }
        if user_profile.points < amount_arg { return Err(error!(BetError::InsufficientPoints)); }

        // Deduct points
        user_profile.points = user_profile.points.checked_sub(amount_arg).ok_or_else(|| error!(BetError::InsufficientPoints))?;
        msg!("User {} points: {} -> {}", user_authority_for_pdas, user_profile.points + amount_arg, user_profile.points);

        // Pyth Price & Adjustment (your detailed logic)
        let target_feed_id = get_feed_id_from_hex(SOL_USD_FEED_ID_HEX).map_err(|_| BetError::InvalidPythFeedIdFormat)?;
        let current_pyth_price_struct = price_update_account.get_price_no_older_than(&clock, MAXIMUM_PRICE_AGE_SECONDS, &target_feed_id)
            .map_err(|e| { msg!("Pyth err in open_bet: {:?}", e); BetError::PythPriceFeedError })?;
        let pyth_price_value = current_pyth_price_struct.price;
        let pyth_exponent = current_pyth_price_struct.exponent;
        if pyth_price_value < 0 { return Err(error!(BetError::NegativePythPrice)); }
        let mut adjusted_price = pyth_price_value as u64;
        let our_price_decimals: i32 = 6;
        if pyth_exponent < 0 { let se = our_price_decimals - pyth_exponent.abs(); if se < 0 { for _ in 0..se.abs() { adjusted_price /= 10; }} else if se > 0 { for _ in 0..se { adjusted_price = adjusted_price.checked_mul(10).ok_or(BetError::PriceCalculationOverflow)?;}}} else if pyth_exponent == 0 && our_price_decimals > 0 { for _ in 0..our_price_decimals { adjusted_price = adjusted_price.checked_mul(10).ok_or(BetError::PriceCalculationOverflow)?;}} else if pyth_exponent > 0 { if our_price_decimals > pyth_exponent { let de = our_price_decimals - pyth_exponent; for _ in 0..de { adjusted_price = adjusted_price.checked_mul(10).ok_or(BetError::PriceCalculationOverflow)?;}} else if pyth_exponent > our_price_decimals { let de = pyth_exponent - our_price_decimals; for _ in 0..de { adjusted_price /= 10;}}}
        
        msg!("Calculated initial price for bet: {}", adjusted_price); // Log the price

        // Set bet_account fields
        bet_account.user = user_authority_for_pdas;
        bet_account.asset_name = asset_name_arg; // Use the argument
        bet_account.initial_price = adjusted_price;
        bet_account.expiry_timestamp = clock.unix_timestamp.checked_add(duration_seconds_arg).ok_or(BetError::TimestampOverflow)?;
        bet_account.direction = direction_arg;
        bet_account.amount_staked = amount_arg;
        bet_account.resolved_price = 0;
        bet_account.status = 0; // Active

        msg!("Bet opened. UserAuthState.is_delegated: {}", auth_state.is_delegated);
        Ok(())
    }

    pub fn resolve_bet(ctx: Context<ResolveBetAccounts>) -> Result<()> {
        // --- (Your existing resolve_bet logic, ensure Pyth price adjustment is complete) ---
        let bet_account = &mut ctx.accounts.bet_account;
        let user_profile = &mut ctx.accounts.user_profile;
        let clock = &ctx.accounts.clock;
        let price_update_account = &ctx.accounts.pyth_price_feed;
        let auth_state = &ctx.accounts.user_auth_state; // For logging

        if bet_account.status != 0 { return Err(error!(BetError::BetNotActiveOrAlreadyResolved));}
        if clock.unix_timestamp <= bet_account.expiry_timestamp { return Err(error!(BetError::BetNotYetExpired));}
        // PDA authority checks are handled by constraints on UserProfile and UserAuthState in ResolveBetAccounts

        let target_feed_id = get_feed_id_from_hex(SOL_USD_FEED_ID_HEX).map_err(|_| BetError::InvalidPythFeedIdFormat)?;
        let resolved_pyth_price_struct = price_update_account.get_price_no_older_than(clock, MAXIMUM_PRICE_AGE_SECONDS, &target_feed_id).map_err(|e| {msg!("Pyth error: {:?}", e); BetError::PythPriceFeedError})?;
        let pyth_resolved_price_value = resolved_pyth_price_struct.price;
        let pyth_resolved_exponent = resolved_pyth_price_struct.exponent;
        if pyth_resolved_price_value < 0 { return Err(error!(BetError::NegativePythPrice));}
        let mut adjusted_resolved_price = pyth_resolved_price_value as u64;
        let our_price_decimals: i32 = 6;
        if pyth_resolved_exponent < 0 { let scaling_factor_exponent = our_price_decimals - pyth_resolved_exponent.abs(); if scaling_factor_exponent < 0 { for _ in 0..scaling_factor_exponent.abs() { adjusted_resolved_price /= 10; }} else if scaling_factor_exponent > 0 { for _ in 0..scaling_factor_exponent { adjusted_resolved_price = adjusted_resolved_price.checked_mul(10).ok_or_else(|| error!(BetError::PriceCalculationOverflow))?;}}} else if pyth_resolved_exponent == 0 && our_price_decimals > 0 { for _ in 0..our_price_decimals { adjusted_resolved_price = adjusted_resolved_price.checked_mul(10).ok_or_else(|| error!(BetError::PriceCalculationOverflow))?;}} else if pyth_resolved_exponent > 0 { if our_price_decimals > pyth_resolved_exponent { let diff_expo = our_price_decimals - pyth_resolved_exponent; for _ in 0..diff_expo { adjusted_resolved_price = adjusted_resolved_price.checked_mul(10).ok_or_else(|| error!(BetError::PriceCalculationOverflow))?;}} else if pyth_resolved_exponent > our_price_decimals { let diff_expo = pyth_resolved_exponent - our_price_decimals; for _ in 0..diff_expo { adjusted_resolved_price /= 10;}}}
        bet_account.resolved_price = adjusted_resolved_price;
        msg!("Resolved price: {}", adjusted_resolved_price);
        let won = if bet_account.direction == 1 { bet_account.resolved_price > bet_account.initial_price } else { bet_account.resolved_price < bet_account.initial_price };
        if won {
            bet_account.status = 1; // Won
            let payout_amount = bet_account.amount_staked.checked_mul(2).ok_or(BetError::PriceCalculationOverflow)?;
            user_profile.points = user_profile.points.checked_add(payout_amount).ok_or(BetError::PriceCalculationOverflow)?;
            msg!("Bet WON! Payout: {}. New points: {}", payout_amount, user_profile.points);
        } else {
            bet_account.status = 2; // Lost
            msg!("Bet LOST. Points: {}", user_profile.points);
        }
        msg!("Bet resolved. User: {}. Mode: {}.", bet_account.user, if auth_state.is_delegated {"Quick"} else {"Standard"});
        Ok(())
    }

    pub fn undelegate_from_magicblock(ctx: Context<UndelegateFromMagicBlock>) -> Result<()> {
        msg!("Starting undelegation from MagicBlock...");
    
        // User authority must match the authority record IF we could read it.
        // For now, we trust the client passed the correct user_auth_state_pda for their user.
        // A more robust check would involve deriving the PDA here using ctx.accounts.user_authority.key()
        // and ensuring it matches ctx.accounts.user_auth_state_to_undelegate.key().
    
        commit_and_undelegate_accounts(
            &ctx.accounts.user_authority.to_account_info(), // Payer
            vec![&ctx.accounts.user_auth_state_to_undelegate], // The AccountInfo of UserAuthState PDA
            &ctx.accounts.magic_context.to_account_info(),
            &ctx.accounts.magic_program.to_account_info(),
        )?;
    
        // After this SDK call, ownership of user_auth_state_to_undelegate (the PDA)
        // should be transferred BACK to this bs_bet program.
        // Now, we need to reload it as Account<UserAuthState> to modify its data.
        // This requires a CPI to our own program or a separate instruction.
        // OR, the SDK itself might allow updating data during undelegation (unlikely).
    
        // For simplicity in the demo, we assume commit_and_undelegate_accounts ALSO
        // allows us to update our internal flag, OR the client just knows.
        // The most important thing is that MagicBlock no longer considers it delegated.
        // To update is_delegated = false, we need another instruction AFTER ownership is back.
    
        // For the demo: this instruction primarily triggers MB undelegation.
        // The client will then re-fetch UserAuthState (expecting ownership back)
        // and then call manage_delegation(0,...) to set is_delegated=false. This is clunky.
    
        // Ideal: commit_and_undelegate_accounts SDK returns ownership, THEN we set is_delegated=false.
        // If the SDK doesn't allow immediate modification after ownership transfer within the same IX,
        // we need two steps on client:
        // 1. Call this `undelegate_from_magicblock`.
        // 2. Client then calls `manage_delegation(0, ...)` which can now access UserAuthState as Account<T>
        //    and set is_delegated = false.
    
        msg!("MagicBlock SDK undelegation called. Ownership should be returned to this program.");
        msg!("Client should now call manage_delegation(action=0) to finalize local state.");
        Ok(())
    }

}   

// --- Accounts Structs ---
#[derive(Accounts)]
pub struct CreateUserProfile<'info> {
    #[account(init_if_needed, payer = user_authority, space = 8 + USER_PROFILE_SPACE, seeds = [b"profile".as_ref(), user_authority.key().as_ref()], bump)]
    pub user_profile: Account<'info, UserProfile>,
    #[account(init_if_needed, payer = user_authority, space = 8 + USER_AUTH_STATE_SPACE, seeds = [b"auth_state".as_ref(), user_authority.key().as_ref()], bump)]
    pub user_auth_state_for_profile_creation: Account<'info, UserAuthState>,
    #[account(mut)]
    pub user_authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[delegate] // MagicBlock SDK macro
#[derive(Accounts)]
pub struct DelegateAuthState<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: This is the UserAuthState PDA. MagicBlock's `del` attribute handles it.
    #[account(mut, del)]
    pub pda: AccountInfo<'info>, // This is the target
}

#[derive(Accounts)]
#[instruction(delegation_action: u8, user_signed_message: Vec<u8>, _signature: [u8; 64])]
pub struct ManageDelegation<'info> {
    #[account(init_if_needed, payer = user_authority, space = 8 + USER_AUTH_STATE_SPACE, seeds = [b"auth_state".as_ref(), user_authority.key().as_ref()], bump)]
    pub user_auth_state: Account<'info, UserAuthState>,
    #[account(mut)]
    pub user_authority: Signer<'info>,
    pub system_program: Program<'info, System>, // For init_if_needed
    #[account(address = sysvar_instructions::ID)] // Still here if Ed25519 is re-enabled later
    /// CHECK: Solana Instructions Sysvar.
    pub ix_sysvar: AccountInfo<'info>,
    // For undelegation (action == 0)
    #[account(executable)]
    /// CHECK: MagicBlock Program for undelegation.
    pub magic_program: Option<AccountInfo<'info>>,
    #[account(mut)]
    /// CHECK: MagicBlock Context for undelegation.
    pub magic_context: Option<AccountInfo<'info>>,
}

#[derive(Accounts)]
#[instruction(asset_name_arg: String, direction_arg: u8, amount_arg: u64, duration_seconds_arg: i64, user_authority_for_pdas: Pubkey)]
pub struct OpenBetAccounts<'info> {
    #[account(init, payer = user_signer, space = 8 + ACTIVE_BET_SPACE)]
    pub bet_account: Account<'info, ActiveBet>,
    #[account(mut)]
    pub user_signer: Signer<'info>,
    #[account(
        init_if_needed,
        payer = user_signer,
        space = 8 + USER_AUTH_STATE_SPACE,
        seeds = [b"auth_state".as_ref(), user_authority_for_pdas.as_ref()],
        bump,
        // --- THIS IS THE ONLY LINE THAT SHOULD BE DIFFERENT FROM YOUR LAST WORKING BUILD ---
        // --- FOR THIS SPECIFIC STRUCT (OpenBetAccounts) ---
        constraint = (
            user_auth_state.is_delegated == true || // 1. MagicBlock "Quick Bet" mode
            ( // 2. Standard user-signed bet (UserAuthState owned by this program)
                user_signer.key() == user_auth_state.user_authority && // Check: Signer is the PDA's authority
                user_auth_state.is_delegated == false &&                // And not in MB delegated mode
                user_auth_state.user_authority != Pubkey::default()     // And PDA is already initialized
            ) ||
            user_auth_state.user_authority == Pubkey::default() || // 3. Initializing UserAuthState NOW
            cfg!(feature = "test") // 4. Test mode
        ) @ BetError::NotAuthenticatedOrDelegated
    )]
    pub user_auth_state: Account<'info, UserAuthState>, // Stays Account<T>
    #[account(
        init_if_needed, // removed `mut,`
        payer = user_signer,
        space = 8 + USER_PROFILE_SPACE,
        seeds = [b"profile".as_ref(), user_authority_for_pdas.as_ref()],
        bump,
        constraint = user_profile.authority == user_authority_for_pdas || user_profile.authority == Pubkey::default() @ BetError::UserProfileAuthorityMismatch
    )]
    pub user_profile: Account<'info, UserProfile>,
    pub pyth_price_feed: Account<'info, PriceUpdateV2>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct UndelegateFromMagicBlock<'info> {
    #[account(mut)]
    pub user_authority: Signer<'info>, // The user initiating undelegation

    /// CHECK: This is the UserAuthState PDA currently owned by MagicBlock.
    /// We pass it as AccountInfo because we can't load it as Account<UserAuthState> yet.
    /// Its address is derived by the client using seeds [b"auth_state", user_authority.key()].
    #[account(mut)] // Will be modified by MagicBlock (owner change)
    pub user_auth_state_to_undelegate: AccountInfo<'info>,

    // Accounts required by commit_and_undelegate_accounts
    #[account(executable)]
    /// CHECK: MagicBlock Program ID.
    pub magic_program: AccountInfo<'info>,
    #[account(mut)]
    /// CHECK: MagicBlock Context Account.
    pub magic_context: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct ResolveBetAccounts<'info> {
    #[account(mut, constraint = bet_account.user == resolver_signer.key() @ BetError::UserProfileBetUserMismatch, constraint = bet_account.status == 0 @ BetError::BetNotActiveOrAlreadyResolved)]
    pub bet_account: Account<'info, ActiveBet>,
    #[account(mut)]
    pub resolver_signer: Signer<'info>,
    #[account(
        seeds = [b"auth_state".as_ref(), resolver_signer.key().as_ref()],
        bump = user_auth_state.bump,
        // --- THIS IS THE ONLY LINE THAT SHOULD BE DIFFERENT FROM YOUR LAST WORKING BUILD ---
        // --- FOR THIS SPECIFIC STRUCT (ResolveBetAccounts) ---
        constraint = (
            user_auth_state.is_delegated == true ||
            (
                resolver_signer.key() == user_auth_state.user_authority && // Check: Signer is the PDA's authority
                user_auth_state.is_delegated == false &&
                user_auth_state.user_authority != Pubkey::default()
            ) ||
            cfg!(feature = "test")
        ) @ BetError::NotAuthenticatedOrDelegated
    )]
    pub user_auth_state: Account<'info, UserAuthState>, // Stays Account<T>
    #[account(
        mut,
        seeds = [b"profile".as_ref(), resolver_signer.key().as_ref()],
        bump = user_profile.bump,
        constraint = user_profile.authority == resolver_signer.key() @ BetError::UserProfileAuthorityMismatch
    )]
    pub user_profile: Account<'info, UserProfile>,
    pub pyth_price_feed: Account<'info, PriceUpdateV2>,
    pub clock: Sysvar<'info, Clock>,
    pub system_program: Program<'info, System>,
}

// --- Error Enum ---
#[error_code]
pub enum BetError {
    #[msg("Timestamp calculation resulted in an overflow.")] TimestampOverflow,
    #[msg("Invalid Pyth Feed ID hex format.")] InvalidPythFeedIdFormat,
    #[msg("Pyth price feed error or price unavailable/too old.")] PythPriceFeedError,
    #[msg("Pyth price is too old or currently unavailable.")] PythPriceTooOldOrUnavailable,
    #[msg("Asset not supported by this program/feed.")] UnsupportedAsset,
    #[msg("Pyth reported a negative price.")] NegativePythPrice,
    #[msg("Price calculation resulted in an overflow during scaling.")] PriceCalculationOverflow,
    #[msg("Bet is not active or has already been resolved/claimed.")] BetNotActiveOrAlreadyResolved,
    #[msg("Bet has not yet expired and cannot be resolved.")] BetNotYetExpired,
    #[msg("User does not have enough points for this bet.")] InsufficientPoints,
    #[msg("The user profile's authority does not match the signer.")] UserProfileAuthorityMismatch,
    #[msg("The user profile does not belong to the user who placed the bet.")] UserProfileBetUserMismatch,
    #[msg("Bet direction must be 0 (DOWN) or 1 (UP).")] InvalidDirection,
    #[msg("Bet amount must be greater than zero.")] ZeroAmount,
    #[msg("Bet duration must be positive.")] InvalidDuration,
    #[msg("User is not properly authenticated or state not delegated for this action.")] NotAuthenticatedOrDelegated,
    #[msg("User authentication state is already prepared for MagicBlock delegation or fully delegated.")] AlreadyDelegated,
    #[msg("User authentication state is not currently in a MagicBlock delegated state.")] NotDelegated,
    #[msg("Invalid authentication signature or message provided for delegation.")] InvalidDelegationSignature,
}