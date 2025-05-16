import { useEffect, useState, useRef } from "react";
import { HermesClient } from "@pythnetwork/hermes-client";

// SOL/USD price feed ID (mainnet-beta, hex format)
const SOL_USD_PRICE_ID = "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";
const CHART_WIDTH = 600;
const CHART_HEIGHT = 400;
const CHART_PADDING = 40;

export default function PriceTracker() {
    const [price, setPrice] = useState<number | null>(null);
    const [history, setHistory] = useState<number[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const historyRef = useRef<number[]>([]);

    // Example: Simulate a bet at the latest price and target 20 points ahead
    const betIndex = history.length > 0 ? history.length - 20 : 0;
    const betPrice = history[betIndex] || null;
    const targetIndex = history.length > 0 ? history.length - 1 : 0;

    useEffect(() => {
        const connection = new HermesClient("https://hermes.pyth.network", {});
        let eventSource: EventSource | null = null;
        let cancelled = false;

        async function subscribe() {
            try {
                eventSource = await connection.getPriceUpdatesStream([SOL_USD_PRICE_ID]);
                eventSource.onmessage = (event) => {
                    if (cancelled) return;
                    try {
                        const data = JSON.parse(event.data);
                        if (data.parsed && data.parsed.length > 0) {
                            const priceObj = data.parsed[0].price;
                            if (priceObj && typeof priceObj.price === "string" && typeof priceObj.expo === "number") {
                                const newPrice = Number(priceObj.price) * Math.pow(10, priceObj.expo);
                                setPrice(newPrice);
                                historyRef.current = [...historyRef.current, newPrice].slice(-60);
                                setHistory([...historyRef.current]);
                            }
                        }
                    } catch (err) {
                        setError("Failed to parse price update");
                    }
                };
                eventSource.onerror = (err) => {
                    setError("Error receiving price updates");
                    eventSource?.close();
                };
                setLoading(false);
            } catch (err) {
                setError("Failed to connect to Hermes");
                setLoading(false);
            }
        }
        subscribe();
        return () => {
            cancelled = true;
            eventSource?.close();
        };
    }, []);

    // SVG helpers
    const minPrice = Math.min(...history, price ?? Infinity);
    const maxPrice = Math.max(...history, price ?? -Infinity);
    const yScale = (p: number) => {
        if (maxPrice === minPrice) return CHART_HEIGHT / 2;
        return (
            CHART_HEIGHT - CHART_PADDING - ((p - minPrice) / (maxPrice - minPrice)) * (CHART_HEIGHT - 2 * CHART_PADDING)
        );
    };
    const xScale = (i: number) => {
        if (history.length <= 1) return CHART_PADDING;
        return CHART_PADDING + (i / (history.length - 1)) * (CHART_WIDTH - 2 * CHART_PADDING);
    };
    const linePoints = history.map((p, i) => `${xScale(i)},${yScale(p)}`).join(" ");

    return (
        <div className="bg-gray-900 p-6 rounded-lg shadow-lg w-full max-w-xl mx-auto">
            <h2 className="text-2xl font-bold mb-4 text-center">Realtime Price Tracker</h2>
            {loading ? (
                <div className="text-center">Loading...</div>
            ) : error ? (
                <div className="text-red-500 text-center">{error}</div>
            ) : (
                <>
                    <div className="text-lg font-semibold mb-2 text-center">
                        Current SOL Price: {price ? `$${price}` : "-"}
                    </div>
                    <div className="flex items-center justify-center">
                        <svg
                            width={CHART_WIDTH}
                            height={CHART_HEIGHT}
                            style={{ background: "#18181b", borderRadius: 12, border: "1px solid #222" }}
                        >
                            {/* Y axis grid lines and labels */}
                            {[0, 0.25, 0.5, 0.75, 1].map((t) => {
                                const y = CHART_PADDING + t * (CHART_HEIGHT - 2 * CHART_PADDING);
                                const priceLabel = (maxPrice - (maxPrice - minPrice) * t).toFixed(4);
                                return (
                                    <g key={t}>
                                        <line
                                            x1={CHART_PADDING}
                                            x2={CHART_WIDTH - CHART_PADDING}
                                            y1={y}
                                            y2={y}
                                            stroke="#333"
                                            strokeDasharray="2 2"
                                        />
                                        <text
                                            x={8}
                                            y={y + 4}
                                            fill="#aaa"
                                            fontSize={12}
                                        >
                                            {priceLabel}
                                        </text>
                                        {/* Add right-side label */}
                                        <text
                                            x={CHART_WIDTH - CHART_PADDING + 8}
                                            y={y + 4}
                                            fill="#aaa"
                                            fontSize={12}
                                            textAnchor="start"
                                        >
                                            {priceLabel}
                                        </text>
                                    </g>
                                );
                            })}
                            {/* Price line */}
                            <polyline
                                fill="none"
                                stroke="#fff"
                                strokeWidth={2}
                                points={linePoints}
                            />
                            {/* Bet price line */}
                            {betPrice && (
                                <line
                                    x1={CHART_PADDING}
                                    x2={CHART_WIDTH - CHART_PADDING}
                                    y1={yScale(betPrice)}
                                    y2={yScale(betPrice)}
                                    stroke="red"
                                    strokeDasharray="4 4"
                                />
                            )}
                            {/* Target time line */}
                            {history.length > 0 && (
                                <line
                                    x1={xScale(targetIndex)}
                                    x2={xScale(targetIndex)}
                                    y1={CHART_PADDING}
                                    y2={CHART_HEIGHT - CHART_PADDING}
                                    stroke="blue"
                                    strokeDasharray="4 4"
                                />
                            )}
                        </svg>
                    </div>
                </>
            )}
        </div>
    );
} 