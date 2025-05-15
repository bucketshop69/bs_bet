# BS Bet Client Integration Guide

## Overview
This document outlines the integration plan for client applications to interact with the BS Bet program on Solana. The program allows users to place bets on SOL/USD price movements using a points-based system.

## Program Details
- Program ID: `3awHJrzJbNCCLcQNEdh5mcVfPZW55w5v7tQhDwkx7Hpt`
- Supported Asset: SOL/USD
- Initial Points: 1000 points per user

## Integration Steps

### 1. Setup and Dependencies
```typescript
// Required dependencies
- @solana/web3.js
- @project-serum/anchor
- @pythnetwork/client
```

### 2. Account Structure
The program uses several PDAs (Program Derived Addresses):

1. **User Profile PDA**
   - Seeds: `["profile", userPubkey]`
   - Stores user points balance
   - Space: 41 bytes

2. **User Auth State PDA**
   - Seeds: `["auth_state", userPubkey]`
   - Manages delegation state
   - Space: 58 bytes

3. **Active Bet Account**
   - Created per bet
   - Space: 90 bytes + asset name length

### 3. Core Integration Functions

#### 3.1 User Profile Management
```typescript
async function createUserProfile(
  wallet: Wallet,
  connection: Connection
): Promise<TransactionSignature> {
  // Implementation for creating/accessing user profile
  // Returns transaction signature
}
```

#### 3.2 Authentication and Delegation
```typescript
async function prepareDelegation(
  wallet: Wallet,
  connection: Connection
): Promise<{
  message: string,
  signature: Uint8Array
}> {
  // Implementation for preparing delegation
  // Returns message to sign and signature
}

async function delegateAuthState(
  wallet: Wallet,
  connection: Connection,
  signature: Uint8Array
): Promise<TransactionSignature> {
  // Implementation for delegating auth state
  // Returns transaction signature
}
```

#### 3.3 Bet Management
```typescript
async function openBet(
  wallet: Wallet,
  connection: Connection,
  params: {
    direction: 'UP' | 'DOWN',
    amount: number,
    durationSeconds: number
  }
): Promise<TransactionSignature> {
  // Implementation for opening a bet
  // Returns transaction signature
}

async function resolveBet(
  wallet: Wallet,
  connection: Connection,
  betAccount: PublicKey
): Promise<TransactionSignature> {
  // Implementation for resolving a bet
  // Returns transaction signature
}
```

### 4. Error Handling
Implement proper error handling for common scenarios:
- Insufficient points
- Invalid bet parameters
- Authentication failures
- Network errors

### 5. Price Feed Integration
```typescript
async function getCurrentSolPrice(
  connection: Connection
): Promise<number> {
  // Implementation for fetching current SOL/USD price
  // Returns price in USD
}
```

### 6. Transaction Flow

#### 6.1 New User Flow
1. Create user profile
2. Prepare delegation message
3. Sign message with wallet
4. Delegate auth state
5. Ready to place bets

#### 6.2 Bet Placement Flow
1. Verify user profile exists
2. Check points balance
3. Get current SOL price
4. Create bet account
5. Submit bet transaction

#### 6.3 Bet Resolution Flow
1. Check bet expiry
2. Get current SOL price
3. Submit resolution transaction
4. Update user points

### 7. Best Practices

#### 7.1 Security
- Always verify transaction signatures
- Implement proper error handling
- Use secure key management
- Validate all user inputs

#### 7.2 Performance
- Cache user profile data
- Implement proper retry mechanisms
- Use websocket connections for real-time updates

#### 7.3 User Experience
- Show clear error messages
- Implement loading states
- Provide transaction status updates
- Display points balance prominently

### 8. Testing Strategy
1. Unit tests for all integration functions
2. Integration tests with local validator
3. Test cases for error scenarios
4. End-to-end testing with mainnet fork

### 9. Monitoring and Maintenance
- Track transaction success rates
- Monitor points distribution
- Log error rates
- Track user engagement metrics

## Next Steps
1. Set up development environment
2. Implement core integration functions
3. Add error handling
4. Implement UI components
5. Add testing
6. Deploy to production

## Resources
- [Solana Web3.js Documentation](https://solana-labs.github.io/solana-web3.js/)
- [Anchor Framework Documentation](https://www.anchor-lang.com/)
- [Pyth Network Documentation](https://docs.pyth.network/) 