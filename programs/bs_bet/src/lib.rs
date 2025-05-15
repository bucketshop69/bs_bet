use anchor_lang::{
    prelude::*,
    solana_program::{
        clock::Clock,
        ed25519_program,
        instruction::Instruction as SolanaInstruction,
        program::invoke,
        pubkey::Pubkey,
        sysvar::instructions as sysvar_instructions,
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

declare_id!("3awHJrzJbNCCLcQNEdh5mcVfPZW55w5v7tQhDwkx7Hpt");
pub const SOL_USD_FEED_ID_HEX: &str =
    "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";
pub const MAXIMUM_PRICE_AGE_SECONDS: u64 = 3600 * 2;

const STRING_LENGTH_PREFIX: usize = 4;
const MAX_ASSET_NAME_LENGTH: usize = 20;
const DISCRIMINATOR_LENGTH: usize = 8;

#[account]
#[derive(Default)]
pub struct UserAuthState {
    pub user_authority: Pubkey, // The user's main wallet address
    pub is_delegated: bool,
    pub delegation_timestamp: i64,
    pub nonce: u64,         // To prevent signature replay for delegation
    pub bump: u8,
}

pub const USER_AUTH_STATE_SPACE: usize = DISCRIMINATOR_LENGTH  // 8
                                   + 32                    // user_authority
                                   + 1                     // is_delegated
                                   + 8                     // delegation_timestamp
                                   + 8                     // nonce
                                   + 1;                    // bump
                                   // = 58 bytes

#[account]
#[derive(Default)]
pub struct ActiveBet {
    pub user: Pubkey,
    pub asset_name: String,
    pub initial_price: u64,
    pub expiry_timestamp: i64,
    pub direction: u8,
    pub amount_staked: u64,
    pub resolved_price: u64,
    pub status: u8,
}

const ACTIVE_BET_SPACE: usize = DISCRIMINATOR_LENGTH
                               + 32
                               + STRING_LENGTH_PREFIX + MAX_ASSET_NAME_LENGTH
                               + 8
                               + 8
                               + 1
                               + 8
                               + 8
                               + 1;

pub fn create_delegation_message(user_pubkey: &Pubkey, nonce: u64) -> String {
    format!("BSBET_DELEGATE_AUTH:{}:{}", user_pubkey, nonce)
}

#[ephemeral]
#[program]
pub mod bs_bet {
    use pyth_solana_receiver_sdk::error::GetPriceError;

    use super::*;

    pub fn open_bet(
        ctx: Context<OpenBetAccounts>,
        asset_name_arg: String,
        direction_arg: u8,
        amount_arg: u64,
        duration_seconds_arg: i64,
        user_authority_for_pdas: Pubkey
    ) -> Result<()> {
        // Ensure the user_signer is the authority of the PDAs being used
        if ctx.accounts.user_signer.key() != user_authority_for_pdas {
            msg!(
                "Transaction signer {} doesn't match authority for PDAs {}",
                ctx.accounts.user_signer.key(),
                user_authority_for_pdas
            );
            return Err(error!(BetError::UserProfileAuthorityMismatch));
        }

        // Additional validation to ensure consistency between user_auth_state and user_authority_for_pdas
        if ctx.accounts.user_auth_state.user_authority != user_authority_for_pdas 
            && ctx.accounts.user_auth_state.user_authority != Pubkey::default() {
            msg!(
                "Auth state authority {} doesn't match expected authority {}",
                ctx.accounts.user_auth_state.user_authority,
                user_authority_for_pdas
            );
            return Err(error!(BetError::UserProfileAuthorityMismatch));
        }

        // Initialize user_auth_state if needed
        if ctx.accounts.user_auth_state.user_authority == Pubkey::default() {
            ctx.accounts.user_auth_state.user_authority = user_authority_for_pdas;
            ctx.accounts.user_auth_state.is_delegated = false;
            ctx.accounts.user_auth_state.delegation_timestamp = 0;
            ctx.accounts.user_auth_state.nonce = 0;
            ctx.accounts.user_auth_state.bump = ctx.bumps.user_auth_state;
        }

        // Initialize user_profile if needed
        if ctx.accounts.user_profile.authority == Pubkey::default() {
            ctx.accounts.user_profile.authority = user_authority_for_pdas;
            ctx.accounts.user_profile.points = INITIAL_USER_POINTS;
            ctx.accounts.user_profile.bump = ctx.bumps.user_profile;
        }

        let bet_account = &mut ctx.accounts.bet_account;
        let user_profile = &mut ctx.accounts.user_profile;
        let clock = Clock::get()?;
        let price_update_account = &ctx.accounts.pyth_price_feed;

        if asset_name_arg != "SOL/USD" {
            return Err(error!(BetError::UnsupportedAsset));
        }
        if direction_arg != 0 && direction_arg != 1 {
            return Err(error!(BetError::InvalidDirection));
        }
        if amount_arg == 0 {
            return Err(error!(BetError::ZeroAmount));
        }
        if duration_seconds_arg <= 0 {
            return Err(error!(BetError::InvalidDuration));
        }

        if user_profile.points < amount_arg {
            return Err(error!(BetError::InsufficientPoints));
        }
        user_profile.points = user_profile
            .points
            .checked_sub(amount_arg)
            .ok_or_else(|| error!(BetError::InsufficientPoints))?;

        msg!(
            "User {} points before bet: {}",
            user_authority_for_pdas,
            user_profile.points + amount_arg
        );
        msg!(
            "Points deducted: {}. New points balance: {}",
            amount_arg,
            user_profile.points
        );

        let target_feed_id = get_feed_id_from_hex(SOL_USD_FEED_ID_HEX)
            .map_err(|_| error!(BetError::InvalidPythFeedIdFormat))?;
        let current_pyth_price_struct = price_update_account
            .get_price_no_older_than(&clock, MAXIMUM_PRICE_AGE_SECONDS, &target_feed_id)
            .map_err(|err: GetPriceError| {
                msg!("Pyth get_price_no_older_than error: {:?}", err);
                match err {
                    GetPriceError::PriceTooOld => error!(BetError::PythPriceTooOldOrUnavailable),
                    _ => error!(BetError::PythPriceFeedError),
                }
            })?;

        let pyth_price_value = current_pyth_price_struct.price;
        let pyth_exponent = current_pyth_price_struct.exponent;
        if pyth_price_value < 0 {
            return Err(error!(BetError::NegativePythPrice));
        }
        let pyth_price_value_u64 = pyth_price_value as u64;
        let our_price_decimals: i32 = 6;
        let mut adjusted_price = pyth_price_value_u64;

        if pyth_exponent < 0 {
            let scaling_factor_exponent = our_price_decimals - pyth_exponent.abs();
            if scaling_factor_exponent < 0 {
                for _ in 0..scaling_factor_exponent.abs() {
                    adjusted_price /= 10;
                }
            } else if scaling_factor_exponent > 0 {
                for _ in 0..scaling_factor_exponent {
                    adjusted_price = adjusted_price
                        .checked_mul(10)
                        .ok_or_else(|| error!(BetError::PriceCalculationOverflow))?;
                }
            }
        } else if pyth_exponent == 0 && our_price_decimals > 0 {
            for _ in 0..our_price_decimals {
                adjusted_price = adjusted_price
                    .checked_mul(10)
                    .ok_or_else(|| error!(BetError::PriceCalculationOverflow))?;
            }
        } else if pyth_exponent > 0 {
            if our_price_decimals > pyth_exponent {
                let diff_expo = our_price_decimals - pyth_exponent;
                for _ in 0..diff_expo {
                    adjusted_price = adjusted_price
                        .checked_mul(10)
                        .ok_or_else(|| error!(BetError::PriceCalculationOverflow))?;
                }
            } else if pyth_exponent > our_price_decimals {
                let diff_expo = pyth_exponent - our_price_decimals;
                for _ in 0..diff_expo {
                    adjusted_price /= 10;
                }
            }
        }

        bet_account.user = user_authority_for_pdas;
        bet_account.asset_name = "SOL/USD".to_string();
        bet_account.initial_price = adjusted_price;
        bet_account.expiry_timestamp = clock
            .unix_timestamp
            .checked_add(duration_seconds_arg)
            .ok_or_else(|| error!(BetError::TimestampOverflow))?;
        bet_account.direction = direction_arg;
        bet_account.amount_staked = amount_arg;
        bet_account.resolved_price = 0;
        bet_account.status = 0;

        msg!("Bet opened successfully with points!");

        Ok(())
    }

    pub fn resolve_bet(ctx: Context<ResolveBetAccounts>) -> Result<()> {
        let bet_account = &mut ctx.accounts.bet_account;
        let user_profile = &mut ctx.accounts.user_profile;
        let clock = &ctx.accounts.clock;
        let price_update_account = &ctx.accounts.pyth_price_feed;

        if bet_account.status != 0 {
            return Err(error!(BetError::BetNotActiveOrAlreadyResolved));
        }
        if clock.unix_timestamp <= bet_account.expiry_timestamp {
            return Err(error!(BetError::BetNotYetExpired));
        }

        let target_feed_id = get_feed_id_from_hex(SOL_USD_FEED_ID_HEX)
            .map_err(|_| error!(BetError::InvalidPythFeedIdFormat))?;
        let resolved_pyth_price_struct = price_update_account
            .get_price_no_older_than(clock, MAXIMUM_PRICE_AGE_SECONDS, &target_feed_id)
            .map_err(|err: GetPriceError| {
                msg!(
                    "Pyth get_price_no_older_than error during resolution: {:?}",
                    err
                );
                match err {
                    GetPriceError::PriceTooOld => error!(BetError::PythPriceTooOldOrUnavailable),
                    _ => error!(BetError::PythPriceFeedError),
                }
            })?;

        let pyth_resolved_price_value = resolved_pyth_price_struct.price;
        let pyth_resolved_exponent = resolved_pyth_price_struct.exponent;
        if pyth_resolved_price_value < 0 {
            return Err(error!(BetError::NegativePythPrice));
        }
        let pyth_resolved_price_value_u64 = pyth_resolved_price_value as u64;
        let our_price_decimals: i32 = 6;
        let mut adjusted_resolved_price = pyth_resolved_price_value_u64;

        if pyth_resolved_exponent < 0 {
            let scaling_factor_exponent = our_price_decimals - pyth_resolved_exponent.abs();
            if scaling_factor_exponent < 0 {
                for _ in 0..scaling_factor_exponent.abs() {
                    adjusted_resolved_price /= 10;
                }
            } else if scaling_factor_exponent > 0 {
                for _ in 0..scaling_factor_exponent {
                    adjusted_resolved_price = adjusted_resolved_price
                        .checked_mul(10)
                        .ok_or_else(|| error!(BetError::PriceCalculationOverflow))?;
                }
            }
        } else if pyth_resolved_exponent == 0 && our_price_decimals > 0 {
            for _ in 0..our_price_decimals {
                adjusted_resolved_price = adjusted_resolved_price
                    .checked_mul(10)
                    .ok_or_else(|| error!(BetError::PriceCalculationOverflow))?;
            }
        } else if pyth_resolved_exponent > 0 {
            if our_price_decimals > pyth_resolved_exponent {
                let diff_expo = our_price_decimals - pyth_resolved_exponent;
                for _ in 0..diff_expo {
                    adjusted_resolved_price = adjusted_resolved_price
                        .checked_mul(10)
                        .ok_or_else(|| error!(BetError::PriceCalculationOverflow))?;
                }
            } else if pyth_resolved_exponent > our_price_decimals {
                let diff_expo = pyth_resolved_exponent - our_price_decimals;
                for _ in 0..diff_expo {
                    adjusted_resolved_price /= 10;
                }
            }
        }

        bet_account.resolved_price = adjusted_resolved_price;

        let won: bool;
        if bet_account.direction == 1 {
            won = bet_account.resolved_price > bet_account.initial_price;
        } else {
            won = bet_account.resolved_price < bet_account.initial_price;
        }

        if won {
            bet_account.status = 1;
            let payout_amount = bet_account
                .amount_staked
                .checked_mul(2)
                .ok_or_else(|| error!(BetError::PriceCalculationOverflow))?;

            user_profile.points = user_profile
                .points
                .checked_add(payout_amount)
                .ok_or_else(|| error!(BetError::PriceCalculationOverflow))?;

            msg!(
                "Bet WON! Payout: {}. New points balance: {}",
                payout_amount,
                user_profile.points
            );
        } else {
            bet_account.status = 2;
            msg!("Bet LOST. Points balance remains: {}", user_profile.points);
        }

        msg!("Bet resolved for user: {}", bet_account.user);

        Ok(())
    }

    const INITIAL_USER_POINTS: u64 = 1000;

    pub fn create_user_profile(ctx: Context<CreateUserProfile>) -> Result<()> {
        let user_profile = &mut ctx.accounts.user_profile;

        user_profile.authority = *ctx.accounts.user_authority.key;
        user_profile.points = INITIAL_USER_POINTS;
        user_profile.bump = ctx.bumps.user_profile;

        msg!(
            "User profile created/accessed for: {}",
            user_profile.authority
        );
        msg!("Initial points: {}", user_profile.points);
        msg!("Profile PDA: {}", user_profile.key());
        msg!("Bump: {}", user_profile.bump);

        Ok(())
    }

    /// Delegate the user's auth state PDA to MagicBlock
    /// This allows for signature-less transactions via MagicBlock's Ephemeral Rollups
    pub fn delegate_auth_state(ctx: Context<DelegateAuthState>) -> Result<()> {
        ctx.accounts.delegate_pda(
            &ctx.accounts.payer,
            &[
                b"auth_state".as_ref(),
                ctx.accounts.payer.key().as_ref(),
                &[ctx.bumps.pda], // Use the correct bump field name
            ],
            DelegateConfig::default(), // Use default config for now
        )?;
        
        msg!("User auth state delegated to MagicBlock for: {}", ctx.accounts.payer.key());
        Ok(())
    }

    pub fn manage_delegation(
        ctx: Context<ManageDelegation>,
        delegation_action: u8, // 0 for undelegate, 1 for verify signature and prepare for delegation
        user_signed_message: Vec<u8>, // Only used if delegation_action == 1
        signature: [u8; 64]           // Only used if delegation_action == 1
    ) -> Result<()> {
        let auth_state = &mut ctx.accounts.user_auth_state;
        let user_key = ctx.accounts.user_authority.key();
        let clock = Clock::get()?;

        if delegation_action == 1 { // Verify signature and prepare for delegation
            if auth_state.is_delegated {
                return Err(error!(BetError::AlreadyDelegated));
            }

            // Initialize AuthState if it's newly created
            let current_nonce = if auth_state.user_authority == Pubkey::default() {
                // This is a new auth_state being initialized
                auth_state.user_authority = user_key;
                auth_state.bump = ctx.bumps.user_auth_state;
                auth_state.nonce = 0;
                0 // Initial nonce value
            } else {
                // Auth state exists, use its current nonce
                auth_state.nonce
            };

            // 1. Reconstruct and verify the signed message
            // Expected message format: "BSBET_DELEGATE_AUTH:{pubkey}:{nonce}"
            let expected_message = create_delegation_message(&user_key, current_nonce);
            let expected_message_bytes = expected_message.as_bytes();

            // Verify the provided message matches what we expect
            if user_signed_message != expected_message_bytes {
                msg!("Invalid message format. Expected message containing correct nonce and pubkey.");
                return Err(error!(BetError::InvalidDelegationSignature));
            }
            
            // Create Ed25519 program instruction data following Solana's official format
            // Reference: solana_program::ed25519_program::new_verify_instruction
            
            // Format:
            // - num_signatures (1 byte): Always 1 for a single signature
            // - offsets (3 u16): Signature, public key, and message offsets from start of data
            // - signature_data, pubkey_data, message_data in that order
            
            // 1. Start with number of signatures (1)
            let mut instruction_data = vec![1u8];
            
            // 2. Calculate offsets from start of data array
            const HEADER_SIZE: usize = 7; // 1 byte num_sigs + 3 u16 (6 bytes)
            let signature_offset = HEADER_SIZE;
            let pubkey_offset = signature_offset + 64; // Ed25519 signature is 64 bytes
            let message_offset = pubkey_offset + 32;   // Pubkey is 32 bytes
            
            // 3. Add offsets as little-endian u16 values
            instruction_data.extend_from_slice(&(signature_offset as u16).to_le_bytes());
            instruction_data.extend_from_slice(&(pubkey_offset as u16).to_le_bytes());
            instruction_data.extend_from_slice(&(message_offset as u16).to_le_bytes());
            
            // 4. Append data in the expected order
            instruction_data.extend_from_slice(&signature); // 64 bytes signature
            instruction_data.extend_from_slice(user_key.as_ref()); // 32 bytes pubkey
            instruction_data.extend_from_slice(&user_signed_message); // message data

            // Create the Ed25519 verification instruction
            let ed25519_verify_ix = SolanaInstruction {
                program_id: ed25519_program::id(),
                accounts: vec![],
                data: instruction_data,
            };

            // Call the Ed25519 program to verify the signature
            // If this fails, it will return an error
            invoke(
                &ed25519_verify_ix,
                &[
                    ctx.accounts.ix_sysvar.to_account_info(),
                ]
            ).map_err(|err| {
                msg!("Signature verification failed: {:?}", err);
                error!(BetError::InvalidDelegationSignature)
            })?;

            msg!("Signature verified successfully");

            // Update delegation state
            auth_state.is_delegated = true; // Mark as delegated for program-level checks
            auth_state.delegation_timestamp = clock.unix_timestamp;
            
            // Increment nonce for next use (replay protection)
            auth_state.nonce = auth_state.nonce.checked_add(1).unwrap_or(0);

            msg!("UserAuthState marked as delegated. Now call delegate_auth_state instruction.");

        } else if delegation_action == 0 { // Undelegate
            if !auth_state.is_delegated {
                return Err(error!(BetError::NotDelegated));
            }
            
            // Check if the required accounts for undelegation are provided
            let magic_program_info = ctx.accounts.magic_program.as_ref()
                .ok_or_else(|| {
                    msg!("magic_program account is required for undelegation");
                    error!(BetError::InvalidDelegationSignature)
                })?.to_account_info();
            
            let magic_context_info = ctx.accounts.magic_context.as_ref()
                .ok_or_else(|| {
                    msg!("magic_context account is required for undelegation");
                    error!(BetError::InvalidDelegationSignature)
                })?.to_account_info();

            // Perform the undelegation using MagicBlock SDK
            commit_and_undelegate_accounts(
                &ctx.accounts.user_authority.to_account_info(), // Payer
                vec![&auth_state.to_account_info()],            // Account to undelegate
                &magic_context_info,                            // MagicBlock context
                &magic_program_info                             // MagicBlock program
            )?;

            // Update the auth state after successful undelegation
            auth_state.is_delegated = false;
            msg!("UserAuthState PDA undelegated from MagicBlock");

        } else {
            return Err(error!(BetError::InvalidDelegationSignature));
        }
        
        Ok(())
    }
}

#[derive(Accounts)]
pub struct CreateUserProfile<'info> {
    #[account(
        init_if_needed,
        payer = user_authority,
        space = 8 + USER_PROFILE_SPACE,
        seeds = [
            b"profile".as_ref(),
            user_authority.key().as_ref()
        ],
        bump
    )]
    pub user_profile: Account<'info, UserProfile>,

    #[account(mut)]
    pub user_authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

/// Account struct specifically for delegating auth state to MagicBlock
#[delegate]
#[derive(Accounts)]
pub struct DelegateAuthState<'info> {
    /// The user who pays for the transaction and signs it
    #[account(mut)]
    pub payer: Signer<'info>,
    
    /// CHECK: This is a raw account for delegation, validated by the MagicBlock SDK.
    #[account(
        mut, 
        del,
        seeds = [b"auth_state".as_ref(), payer.key().as_ref()],
        bump
    )]
    pub pda: AccountInfo<'info>,
}

#[derive(Accounts)]
#[instruction(delegation_action: u8, user_signed_message: Vec<u8>, signature: [u8; 64])]
pub struct ManageDelegation<'info> {
    #[account(
        init_if_needed,
        payer = user_authority,
        space = 8 + USER_AUTH_STATE_SPACE,
        seeds = [b"auth_state".as_ref(), user_authority.key().as_ref()],
        bump
    )]
    pub user_auth_state: Account<'info, UserAuthState>,

    #[account(mut)]
    pub user_authority: Signer<'info>,

    pub system_program: Program<'info, System>,

    #[account(executable)]
    pub magic_program: Option<AccountInfo<'info>>,
    
    #[account(mut)] // Assuming MB might modify it or needs mut
    pub magic_context: Option<AccountInfo<'info>>,

    /// CHECK: Solana Instructions Sysvar, required for CPI to Ed25519 program
    #[account(address = sysvar_instructions::ID)] // This line is key
    pub ix_sysvar: AccountInfo<'info>,
    
    /// CHECK: Ed25519 program. This is a known Solana native program and is safe.
    /// Required for signature verification CPI.
    #[account(address = ed25519_program::ID)]
    pub ed25519_program: AccountInfo<'info>, // Field name changed from ed25519_program_account
}

#[derive(Accounts)]
pub struct ResolveBetAccounts<'info> {
    /// The ActiveBet account to resolve
    /// This account must have been created by the resolver_signer
    #[account(
        mut, 
        constraint = bet_account.user == resolver_signer.key() @ BetError::UserProfileBetUserMismatch,
        constraint = bet_account.status == 0 @ BetError::BetNotActiveOrAlreadyResolved
    )]
    pub bet_account: Account<'info, ActiveBet>,

    /// The signer of this transaction
    /// Must match the user who created the bet (bet_account.user)
    #[account(mut)]
    pub resolver_signer: Signer<'info>,

    /// The UserAuthState PDA that was previously delegated via manage_delegation
    /// Seeds are derived from the resolver_signer's key
    #[account(
        init_if_needed,
        payer = resolver_signer,
        space = 8 + USER_AUTH_STATE_SPACE,
        seeds = [b"auth_state".as_ref(), resolver_signer.key().as_ref()],
        bump,
        constraint = user_auth_state.user_authority == resolver_signer.key() || user_auth_state.user_authority == Pubkey::default(),
        constraint = (user_auth_state.is_delegated || cfg!(feature = "test") || user_auth_state.user_authority == Pubkey::default()) @ BetError::NotAuthenticatedOrDelegated
    )]
    pub user_auth_state: Account<'info, UserAuthState>,

    /// The UserProfile PDA that tracks the user's points balance
    /// Seeds are derived from the resolver_signer's key
    #[account(
        mut,
        seeds = [b"profile".as_ref(), resolver_signer.key().as_ref()],
        bump,
        constraint = user_profile.authority == resolver_signer.key() || user_profile.authority == Pubkey::default() @ BetError::UserProfileAuthorityMismatch
    )]
    pub user_profile: Account<'info, UserProfile>,

    /// The Pyth price feed account for SOL/USD price data
    pub pyth_price_feed: Account<'info, PriceUpdateV2>,
    
    /// Current clock for timestamp verification
    pub clock: Sysvar<'info, Clock>,

    /// Required for account creation
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(asset_name_arg: String, direction_arg: u8, amount_arg: u64, duration_seconds_arg: i64, user_authority_for_pdas: Pubkey)]
pub struct OpenBetAccounts<'info> {
    /// The new ActiveBet account to be created
    /// This account is client-generated and initialized in this instruction
    /// The rent for this account is paid by user_signer
    #[account(init, payer = user_signer, space = 8 + ACTIVE_BET_SPACE)]
    pub bet_account: Account<'info, ActiveBet>,

    /// The signer of this transaction who pays for ActiveBet rent
    /// For local wallet transactions, this is the user's wallet
    /// For MagicBlock routed transactions, this could potentially be another party
    #[account(mut)]
    pub user_signer: Signer<'info>,

    /// The UserAuthState PDA that was previously delegated via manage_delegation
    /// This account validates that the user_authority_for_pdas has properly delegated authorization
    /// Seeds are derived from the user_authority_for_pdas (not the transaction signer)
    #[account(
        init_if_needed,
        payer = user_signer,
        space = 8 + USER_AUTH_STATE_SPACE,
        seeds = [b"auth_state".as_ref(), user_authority_for_pdas.as_ref()],
        bump,
        constraint = user_auth_state.user_authority == user_authority_for_pdas || user_auth_state.user_authority == Pubkey::default(),
        // Skip delegation check during testing
        constraint = (user_auth_state.is_delegated || user_auth_state.user_authority == Pubkey::default() || cfg!(feature = "test")) @ BetError::NotAuthenticatedOrDelegated
    )]
    pub user_auth_state: Account<'info, UserAuthState>,

    /// The UserProfile PDA that tracks the user's points balance
    /// Seeds are derived from the user_authority_for_pdas (not the transaction signer)
    #[account(
        mut,
        seeds = [b"profile".as_ref(), user_authority_for_pdas.as_ref()],
        bump,
        constraint = user_profile.authority == user_authority_for_pdas || user_profile.authority == Pubkey::default() @ BetError::UserProfileAuthorityMismatch
    )]
    pub user_profile: Account<'info, UserProfile>,

    /// The Pyth price feed account for SOL/USD price data
    pub pyth_price_feed: Account<'info, PriceUpdateV2>,
    
    /// Required for account creation
    pub system_program: Program<'info, System>,
}

#[account]
#[derive(Default)]
pub struct UserProfile {
    pub authority: Pubkey,
    pub points: u64,
    pub bump: u8,
}

const USER_PROFILE_SPACE: usize = DISCRIMINATOR_LENGTH
                                + 32
                                + 8
                                + 1;

#[error_code]
pub enum BetError {
    #[msg("Timestamp calculation resulted in an overflow.")]
    TimestampOverflow,
    #[msg("Invalid Pyth Feed ID hex format.")]
    InvalidPythFeedIdFormat,
    #[msg("Pyth price feed error or price unavailable/too old.")]
    PythPriceFeedError,
    #[msg("Pyth price is too old or currently unavailable.")]
    PythPriceTooOldOrUnavailable,
    #[msg("Asset not supported by this program/feed.")]
    UnsupportedAsset,
    #[msg("Pyth reported a negative price.")]
    NegativePythPrice,
    #[msg("Price calculation resulted in an overflow during scaling.")]
    PriceCalculationOverflow,
    #[msg("Bet is not active or has already been resolved/claimed.")]
    BetNotActiveOrAlreadyResolved,
    #[msg("Bet has not yet expired and cannot be resolved.")]
    BetNotYetExpired,
    #[msg("User does not have enough points for this bet.")]
    InsufficientPoints,
    #[msg("The user profile's authority does not match the signer.")]
    UserProfileAuthorityMismatch,
    #[msg("The user profile does not belong to the user who placed the bet.")]
    UserProfileBetUserMismatch,
    #[msg("Bet direction must be 0 (DOWN) or 1 (UP).")]
    InvalidDirection,
    #[msg("Bet amount must be greater than zero.")]
    ZeroAmount,
    #[msg("Bet duration must be positive.")]
    InvalidDuration,
    #[msg("User is not properly authenticated or state not delegated.")]
    NotAuthenticatedOrDelegated,
    #[msg("User authentication state is already delegated.")]
    AlreadyDelegated,
    #[msg("User authentication state is not currently delegated.")]
    NotDelegated,
    #[msg("Invalid authentication signature provided for delegation.")]
    InvalidDelegationSignature,
}
