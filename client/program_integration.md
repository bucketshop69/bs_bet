# Solana Program Integration Plan

This document outlines how to integrate the `bs_bet` Solana program (see `lib.rs`) with the Next.js frontend. It covers all required flows: user profile, points, bets, delegation, and price feed.

---

## 2. **User Profile & Points**
### **Goal:**
- Create/fetch user profile PDA (holds points).
- Display and update points after bets.

### **Steps:**
1. **On wallet connect:**
    - Derive user profile PDA: `seeds = [b"profile", user_pubkey]`.
    - Call `create_user_profile` if not exists.
    - Fetch and display `points` from profile.
2. **After bet resolution:**
    - Re-fetch profile to update points.

---

## 3. **Betting (Open/Resolve Bets)**
### **Goal:**
- Allow user to open a bet (direction, amount, duration).
- List active bets.
- Resolve bets after expiry.

### **Steps:**
1. **Open Bet:**
    - Derive bet PDA (client-generated, unique address).
    - Derive user profile PDA and user auth state PDA.
    - Fetch Pyth price feed account for SOL/USD.
    - Call `open_bet` with required accounts and args.
    - On success, update UI and points.
2. **List Active Bets:**
    - Query all bet accounts for user (by filter on `user` field).
    - Display status, expiry, direction, etc.
3. **Resolve Bet:**
    - After expiry, call `resolve_bet` with bet, profile, auth state, and Pyth feed accounts.
    - On success, update bet status and points.

---

## 4. **Delegation (MagicBlock/Ephemeral Rollups)**
### **Goal:**
- Allow user to delegate/undelegate their auth state for signature-less transactions.

### **Steps:**
1. **Delegate:**
    - Derive user auth state PDA: `seeds = [b"auth_state", user_pubkey]`.
    - Prepare delegation message: `BSBET_DELEGATE_AUTH:{pubkey}:{nonce}`.
    - User signs message with wallet.
    - Call `manage_delegation` with action=1, message, and signature.
    - On success, call `delegate_auth_state` to complete delegation.
2. **Undelegate:**
    - Call `manage_delegation` with action=0 and required MagicBlock accounts.
    - On success, update UI.
3. **UI:**
    - Show delegation status and allow delegate/undelegate actions.

---

## 5. **Pyth Price Feed**
### **Goal:**
- Fetch real-time SOL/USD price for display and bet resolution.

### **Steps:**
- Use Pyth's JS SDK or REST API for real-time price in UI.
- For program calls, pass the correct Pyth price feed account.

---

## 6. **Account Derivation Summary**
- **User Profile PDA:** `["profile", user_pubkey]`
- **User Auth State PDA:** `["auth_state", user_pubkey]`
- **Bet Account:** Client-generated (unique address)
- **Pyth Price Feed:** Use known SOL/USD feed address

---

## 7. **Integration Points in UI**
- On wallet connect: fetch/create profile, fetch points, check delegation.
- On bet: call `open_bet`, update points, add to active bets.
- On resolve: call `resolve_bet`, update bet status and points.
- On delegation: call `manage_delegation` and `delegate_auth_state`.
- On undelegation: call `manage_delegation` with action=0.
- Use global state/store for user, points, bets, and delegation status.

---

## 8. **Required Packages**
- `@solana/web3.js`
- `@project-serum/anchor`
- `@solana/wallet-adapter-react`
- `@pythnetwork/client` (for UI price feed)
- `ephemeral_rollups_sdk` (if JS SDK available, for delegation)

---

## 9. **Next Steps**
1. Scaffold utility functions for PDA derivation and program calls.
2. Implement hooks for fetching user profile, points, and bets.
3. Build delegation logic (sign message, call instructions).
4. Integrate all flows into UI components. 