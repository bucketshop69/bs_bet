import React from "react";

interface UserProfileProps {
    userPoints: number;
    fixedBetAmount: number;
    isProfileInitialized: boolean; // New prop to indicate if the on-chain profile exists
}

const UserProfile: React.FC<UserProfileProps> = ({
    userPoints,
    fixedBetAmount,
    isProfileInitialized,
}) => (
    <div className="bg-gray-800 rounded-xl shadow p-4 w-full flex flex-col items-center border border-gray-700">
        <div className="flex items-center gap-2 mb-1">
            <span className="text-yellow-400 text-2xl">🏆</span>
            <span className="text-lg font-semibold text-gray-200">Your Points</span>
        </div>
        <div className="text-4xl font-extrabold text-green-400 mb-2">
            {userPoints.toLocaleString()}
        </div>

        {/* Conditional message if profile is not yet created on-chain but points are shown optimistically */}
        {!isProfileInitialized && userPoints === 1000 && ( // Only show if not initialized and points are the optimistic default
            <div className="text-xs text-gray-400 mb-2 italic">
                (Profile will be activated with first action)
            </div>
        )}

        <div className="w-full border-t border-gray-700 my-2"></div>

        <div className="flex items-center gap-2 text-blue-300 text-base mb-1">
            <span className="text-xl">⏱️</span>
            <span>
                All bets: <span className="font-bold text-white">5 minutes</span>
            </span>
        </div>
        <div className="flex items-center gap-2 text-yellow-300 text-base">
            <span className="text-xl">💰</span>
            <span>
                Fixed: <span className="font-bold text-white">{fixedBetAmount.toLocaleString()} points</span>
            </span>
        </div>
    </div>
);

export default UserProfile;