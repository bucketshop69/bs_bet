import React from "react";

export default function BetForm() {
    // Placeholder values for user points and feedback
    const userPoints = 1000; // This should be fetched from user profile
    const fixedBetAmount = 100;
    const [feedback, setFeedback] = React.useState<string | null>(null);
    const [loading, setLoading] = React.useState(false);

    // Button click handlers (to be implemented)
    const handleBet = (direction: "UP" | "DOWN") => {
        setLoading(true);
        setFeedback(null);
        // Simulate async bet placement
        setTimeout(() => {
            setLoading(false);
            setFeedback(`Bet placed: ${direction}`);
        }, 1000);
    };

    return (
        <div className="bg-gray-900 p-6 rounded-lg shadow-lg w-full max-w-xs flex flex-col items-center justify-between h-full min-h-[350px]">
            {/* Points and Bet Info Card */}
            <div className="w-full flex flex-col items-center mb-4">
                <div className="bg-gray-800 rounded-xl shadow p-4 w-full flex flex-col items-center border border-gray-700">
                    <div className="flex items-center gap-2 mb-1">
                        <span className="text-yellow-400 text-2xl">🏆</span>
                        <span className="text-lg font-semibold text-gray-200">Your Points</span>
                    </div>
                    <div className="text-4xl font-extrabold text-green-400 mb-2">{userPoints}</div>
                    <div className="w-full border-t border-gray-700 my-2"></div>
                    <div className="flex items-center gap-2 text-blue-300 text-base mb-1">
                        <span className="text-xl">⏱️</span>
                        <span>All bets: <span className="font-bold text-white">5 minutes</span></span>
                    </div>
                    <div className="flex items-center gap-2 text-yellow-300 text-base">
                        <span className="text-xl">💰</span>
                        <span>Fixed: <span className="font-bold text-white">{fixedBetAmount} points</span></span>
                    </div>
                </div>
            </div>
            <div className="flex flex-col gap-6 w-full flex-1 justify-center items-center">
                <button
                    className="w-full py-6 text-2xl font-bold rounded-lg bg-green-900 hover:bg-green-800 transition text-white shadow-lg mb-2"
                    style={{ minHeight: 124 }}
                    disabled={loading || userPoints < fixedBetAmount}
                    onClick={() => handleBet("UP")}
                >
                    <span className="mr-2">⬆️</span> UP
                </button>
                <button
                    className="w-full py-6 text-2xl font-bold rounded-lg bg-red-900 hover:bg-red-800 transition text-white shadow-lg"
                    style={{ minHeight: 124 }}
                    disabled={loading || userPoints < fixedBetAmount}
                    onClick={() => handleBet("DOWN")}
                >
                    <span className="mr-2">⬇️</span> DOWN
                </button>
            </div>
            <div className="mt-4 h-6 text-center w-full">
                {loading && <span className="text-blue-400">Placing bet...</span>}
                {!loading && feedback && <span className="text-green-400">{feedback}</span>}
                {!loading && userPoints < fixedBetAmount && (
                    <span className="text-red-400">Insufficient points</span>
                )}
            </div>
        </div>
    );
} 