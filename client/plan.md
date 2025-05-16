# Solana Betting dApp UI/UX Plan

## 1. Core Features
- **User Authentication & Delegation**
  - Create user profile
  - Delegate/undelegate user auth state (MagicBlock/Ephemeral Rollups)
- **Betting**
  - Open a bet (choose asset, direction, amount, duration)
  - View active bets
  - Resolve bets (after expiry)
- **Points System**
  - Display user points (from on-chain profile)
- **Price Feed**
  - Show real-time SOL/USD price (from Pyth)
  - Display price chart (historical or recent prices)
- **Wallet Integration**
  - Connect wallet (Phantom, etc.)

## 2. UI/UX Layout Plan
- **Header**
  - App name/logo
  - Wallet connect button
- **Main Content**
  - Price Tracker (real-time SOL/USD price, mini chart)
  - Betting Panel (open new bet, show current points)
  - Active Bets (list of user's open bets, resolve button)
  - Delegation Panel (show status, delegate/undelegate)

## 3. Component Breakdown
- `Navbar` (already present)
- `PriceTracker` (fetches Pyth price, shows chart)
- `BetForm` (open new bet)
- `ActiveBetsList` (list & resolve bets)
- `PointsDisplay` (user points)
- `DelegationPanel` (manage delegation)
- `WalletConnect` (already handled by wallet adapter)

## 4. Data Flow & Integration
- **Wallet Connection:** Use `@solana/wallet-adapter-react`
- **Program Interaction:** Use `@project-serum/anchor` or `@solana/web3.js` for sending transactions
- **Pyth Price Feed:** Use Pyth's JS SDK or REST API for real-time price
- **State Management:** Use React state/hooks or a global state (Zustand, Redux, or Context API)

## 5. Tech Stack
- **Frontend:** React + Next.js
- **Styling:** Tailwind CSS
- **Solana:** `@solana/web3.js`, `@project-serum/anchor`
- **Wallets:** `@solana/wallet-adapter-react`
- **Pyth:** `@pythnetwork/client` or REST API

## 6. Next Steps
1. Scaffold Components: Create the basic React components for each feature.
2. Integrate Wallet: Ensure wallet connect/disconnect works.
3. Fetch Pyth Price: Set up a hook to fetch and update SOL/USD price in real time.
4. Program Calls: Set up Anchor/solana-web3.js to call your program's instructions (open bet, resolve bet, etc.).
5. UI Polish: Add charts, error handling, and responsive design.

## 7. Example Directory Structure
```
/components
  /PriceTracker.tsx
  /BetForm.tsx
  /ActiveBetsList.tsx
  /PointsDisplay.tsx
  /DelegationPanel.tsx
  /WalletConnect.tsx
/pages
  /index.tsx
  /bets.tsx
  /profile.tsx
```

## 8. Notes
- The UI should be modern, responsive, and user-friendly.
- All program instructions and account constraints from `lib.rs` must be respected in the UI logic.
- Pyth price feed integration is critical for both display and bet resolution.
- MagicBlock/Ephemeral Rollups delegation is required for signature-less transactions.

## TODO: PriceTracker Component Implementation

- [ ] Set up Pyth client and fetch the SOL/USD price using WebSocket.
- [ ] Implement real-time updates for price data.
- [ ] Store and update price history for the chart.
- [ ] Integrate a simple line chart (like the example screenshot) for recent price history.
- [ ] When a user places a bet, show a horizontal line at the bet price on the chart.
- [ ] Show a vertical target line for the bet's expiry (e.g., 5 minutes from bet time).
- [ ] Handle loading and error states gracefully.
- [ ] Style the component to match the app's dark theme and keep it clean/simple. 