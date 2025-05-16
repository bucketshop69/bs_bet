"use client";
import { CivicAuthProvider } from "@civic/auth-web3/nextjs";
import Navbar from "../components/Navbar";
import '@solana/wallet-adapter-react-ui/styles.css';
import PriceTracker from "../components/PriceTracker";
import BetForm from "../components/BetForm";
// Import Tailwind styles
import '../styles/globals.css';

function Layout({ children }: { children: React.ReactNode }) {

  return (
    <html lang="en">
      <head>
        {/* Removed synchronous script */}
      </head>
      <body className="bg-gray-800 min-h-screen text-gray-100">
        <CivicAuthProvider>
          <div className="container mx-auto px-4 py-8 max-w-5xl">
            <Navbar />
            <div className="flex flex-col md:flex-row gap-8 justify-end items-stretch mt-8">
              <PriceTracker />
              <BetForm />
            </div>
            <main className="mt-8 bg-gray-800 rounded-lg shadow-lg p-6 border border-gray-700">
              {children}
            </main>
          </div>

        </CivicAuthProvider>
      </body>
    </html>
  )
}

export default Layout;