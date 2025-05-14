use anchor_lang::{
    prelude::*,
    solana_program::clock::Clock,
};
use pyth_solana_receiver_sdk::price_update::{
    get_feed_id_from_hex,
    PriceUpdateV2,
};

declare_id!("FQLt6TZ1r15Pvj8ibh8u7RMcFz2MGeKfNnHm5QsWisdg");
pub const SOL_USD_FEED_ID_HEX: &str =
    "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";
pub const MAXIMUM_PRICE_AGE_SECONDS: u64 = 3600 * 2;

const STRING_LENGTH_PREFIX: usize = 4;
const MAX_ASSET_NAME_LENGTH: usize = 20;
const DISCRIMINATOR_LENGTH: usize = 8;

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
    ) -> Result<()> {
        let bet_account = &mut ctx.accounts.bet_account;
        let user_signer = &ctx.accounts.user_signer;
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
            user_signer.key(),
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

        bet_account.user = *user_signer.key;
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

#[derive(Accounts)]
pub struct ResolveBetAccounts<'info> {
    #[account(
        mut,
        has_one = user @ BetError::UserProfileBetUserMismatch,
    )]
    pub bet_account: Account<'info, ActiveBet>,

    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [b"profile".as_ref(), user.key().as_ref()],
        bump = user_profile.bump,
        constraint = user_profile.authority == user.key() @ BetError::UserProfileAuthorityMismatch
    )]
    pub user_profile: Account<'info, UserProfile>,

    pub pyth_price_feed: Account<'info, PriceUpdateV2>,
    pub clock: Sysvar<'info, Clock>,
}

#[derive(Accounts)]
#[instruction(asset_name_arg: String, direction_arg: u8, amount_arg: u64, duration_seconds_arg: i64)]
pub struct OpenBetAccounts<'info> {
    #[account(
        init,
        payer = user_signer,
        space = 8 + ACTIVE_BET_SPACE,
    )]
    pub bet_account: Account<'info, ActiveBet>,

    #[account(mut)]
    pub user_signer: Signer<'info>,

    #[account(
        mut,
        seeds = [b"profile".as_ref(), user_signer.key().as_ref()],
        bump = user_profile.bump,
        constraint = user_profile.authority == user_signer.key() @ BetError::UserProfileAuthorityMismatch
    )]
    pub user_profile: Account<'info, UserProfile>,

    pub pyth_price_feed: Account<'info, PriceUpdateV2>,
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
}
