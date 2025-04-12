"use client";

import { useState } from "react";
import {
  fetchData, // Fetches news/context for a specific date
  fetchHistoricalStockData, // Fetches price history for the full range
  generateQueries,
  generateSignals,
  sanitizeData,
  validateTicker,
} from "@/app/_actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";

// Interface for historical quote data used in the component
interface HistoricalQuoteData {
  date: Date;
  close: number;
}

// Expanded log interface
interface SimulationDayLog {
  date: string; // YYYY-MM-DD format
  price: number | null;
  signal?: "bullish" | "bearish" | "neutral";
  action?: "buy" | "cover" | "sell" | "short" | "hold";
  sharesTraded?: number;
  sharesHeld: number;
  cash: number;
  portfolioValue: number;
  reason?: string;
  error?: string; // Log errors for specific days
}

// Define types for the action results explicitly
interface StockSignal {
  signal: "bullish" | "bearish" | "neutral";
  confidence: number;
  action: "buy" | "cover" | "sell" | "short" | "hold";
  stocks: number;
  reason: string;
}

interface QueryResult {
  success: boolean;
  data?: { ticker: string; recent_queries: string[]; weekly_queries: string[]; monthly_queries: string[] };
  error?: string;
}

interface FetchResult { // Note: stockData here might be for a small range around sim date, not needed for loop logic
  success: boolean;
  data?: { ticker: string; stockData: any; recentResults: any[]; weeklyResults: any[]; monthlyResults: any[] };
  error?: string;
}

interface SanitizeResult {
  success: boolean;
  data?: { summary_analysis: string[] };
  error?: string;
}

interface SignalResult {
  success: boolean;
  data?: StockSignal;
  error?: string;
}

interface ValidateResult {
  success: boolean;
  ticker?: string;
  error?: string;
}

interface HistoricalDataResult {
    quotes: HistoricalQuoteData[];
    error?: string;
}

export default function SimulationAnalysis() {
  const [ticker, setTicker] = useState<string>("");
  const [timeframe, setTimeframe] = useState<number>(5); // Default timeframe (days)
  const [tradeSize] = useState<number>(100); // Keep internal trade size, remove input for now
  const [initialShares, setInitialShares] = useState<number>(0); // <-- Add state for initial shares
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [simulationLog, setSimulationLog] = useState<SimulationDayLog[]>([]);
  const [finalPortfolioValue, setFinalPortfolioValue] = useState<number | null>(null);
  const [initialCash] = useState<number>(10000); // Starting cash

  const handleRunSimulation = async () => {
    setIsLoading(true);
    setError(null);
    setSimulationLog([]);
    setFinalPortfolioValue(null);
    const currentLog: SimulationDayLog[] = [];

    console.log(`Running simulation for ${ticker} over ${timeframe} days...`);

    try {
      // 1. Validate Ticker
      const validateResult: ValidateResult = await validateTicker(ticker);
      if (!validateResult.success || !validateResult.ticker) {
        throw new Error(validateResult.error || "Invalid ticker symbol");
      }
      const validatedTicker = validateResult.ticker;
      console.log("Ticker validated:", validatedTicker);

      // 2. Fetch historical stock data for the timeframe
      const today = new Date();
      const endDate = new Date(today);
      // Ensure endDate is at least yesterday if today is selected
      endDate.setDate(endDate.getDate() - 1);

      const startDate = new Date(endDate);
      startDate.setDate(endDate.getDate() - timeframe); // Go back `timeframe` days from end date

      // Fetch one extra day back for the initial portfolio value calculation
      const fetchStartDate = new Date(startDate);
      fetchStartDate.setDate(startDate.getDate() - 1);

      console.log(`Fetching historical data from ${fetchStartDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);
      const historicalDataResult: HistoricalDataResult = await fetchHistoricalStockData(validatedTicker, fetchStartDate, endDate);

      if (historicalDataResult.error || !historicalDataResult.quotes || historicalDataResult.quotes.length === 0) {
        throw new Error(historicalDataResult.error || `No historical stock data found for ${validatedTicker} in the required range.`);
      }

      // Ensure quotes are sorted by date
      const historicalQuotes = historicalDataResult.quotes.sort((a, b) => a.date.getTime() - b.date.getTime());
      console.log(`Fetched ${historicalQuotes.length} historical quotes.`);

      if (historicalQuotes.length < 2) {
        throw new Error("Not enough historical data points to run simulation.");
      }

      // Initialize portfolio
      let cash = initialCash;
      let sharesHeld = initialShares; // <-- Use initialShares state here
      // Use the first available price (fetchStartDate price) to calculate initial value
      const initialPrice = historicalQuotes[0].close;
      // <-- Calculate initial value based on initial cash AND initial shares
      let currentPortfolioValue = cash + sharesHeld * initialPrice;

      currentLog.push({
        date: "Start",
        price: initialPrice,
        sharesHeld: sharesHeld, // <-- Log initial shares
        cash: cash,
        portfolioValue: currentPortfolioValue,
      });
      setSimulationLog([...currentLog]); // Show starting state

      // 3. Loop through each *trading day* in the fetched historical data (excluding the first day used for initial price)
      // We iterate from the second quote up to the second-to-last quote for making decisions
      // The last quote is only used to calculate the final portfolio value of the last trade
      for (let i = 1; i < historicalQuotes.length; i++) {
        const currentDayQuote = historicalQuotes[i];
        const simulationDate = currentDayQuote.date;
        const currentDateStr = simulationDate.toISOString().split('T')[0];
        const currentPrice = currentDayQuote.close; // Price to execute trades at

        console.log(`--- Simulating Day ${i}: ${currentDateStr}, Price: $${currentPrice.toFixed(2)} ---`);

        let daySignal: StockSignal | undefined;
        let dayError: string | undefined;
        let sharesTraded = 0; // <-- Declare sharesTraded here, outside try block

        try {
          // b. Generate queries for the current simulation date
          console.log(`Generating queries for ${currentDateStr}...`);
          const queriesResult: QueryResult = await generateQueries(validatedTicker, simulationDate);
          if (!queriesResult.success || !queriesResult.data) throw new Error(queriesResult.error || "Failed to generate queries");

          const { recent_queries, weekly_queries, monthly_queries } = queriesResult.data;

          // c. Fetch news/data for the current simulation date
          // We pass simulationDate here, but ignore the returned stockData as we use historicalQuotes
          console.log(`Fetching news data for ${currentDateStr}...`);
          const fetchResult: FetchResult = await fetchData(validatedTicker, recent_queries, weekly_queries, monthly_queries, simulationDate);
          if (!fetchResult.success || !fetchResult.data) throw new Error(fetchResult.error || "Failed to fetch news data");

          const { recentResults, weeklyResults, monthlyResults } = fetchResult.data;

          // d. Sanitize data
          console.log("Analyzing data...");
          const sanitizeResult: SanitizeResult = await sanitizeData(recentResults, weeklyResults, monthlyResults);
          if (!sanitizeResult.success || !sanitizeResult.data) throw new Error(sanitizeResult.error || "Failed to sanitize data");

          // e. Generate signal
          console.log("Generating signal...");
          const signalsResult: SignalResult = await generateSignals(sanitizeResult.data.summary_analysis);
          if (!signalsResult.success || !signalsResult.data) throw new Error(signalsResult.error || "Failed to generate signals");
          daySignal = signalsResult.data;
          console.log(`Signal: ${daySignal.signal}, Action: ${daySignal.action}, Stocks: ${daySignal.stocks}, Confidence: ${daySignal.confidence}%`);

          // f. Execute simulated trade
          const sharesToTrade = tradeSize; // USE USER-DEFINED tradeSize

          switch (daySignal.action) {
            case 'buy':
              if (cash >= sharesToTrade * currentPrice) {
                sharesTraded = sharesToTrade; // Modify sharesTraded declared outside
                sharesHeld += sharesTraded;
                cash -= sharesTraded * currentPrice;
                console.log(`Executed BUY ${sharesTraded} shares @ $${currentPrice.toFixed(2)}`);
              } else {
                console.log(`Insufficient cash to BUY ${sharesToTrade} shares.`);
                daySignal.action = 'hold'; // Cannot execute, so hold
                sharesTraded = 0;
              }
              break;
            case 'sell':
              if (sharesHeld > 0) {
                  sharesTraded = Math.min(sharesToTrade, sharesHeld); // Modify sharesTraded declared outside
                  sharesHeld -= sharesTraded;
                  cash += sharesTraded * currentPrice;
                  console.log(`Executed SELL ${sharesTraded} shares @ $${currentPrice.toFixed(2)}`);
              } else {
                  console.log("No shares to SELL.");
                  daySignal.action = 'hold';
                  sharesTraded = 0;
              }
              break;
            // TODO: Implement short/cover logic if needed - requires tracking short positions
            case 'short':
                console.warn("Short action simulation not fully implemented.");
                // Assuming we can short: cash += sharesTraded * currentPrice; sharesHeld -= sharesTraded (track negative shares?)
                daySignal.action = 'hold'; // For now, treat as hold
                sharesTraded = 0;
                break;
             case 'cover':
                console.warn("Cover action simulation not fully implemented.");
                // Assuming we need to buy back: cash -= sharesTraded * currentPrice; sharesHeld += sharesTraded
                daySignal.action = 'hold'; // For now, treat as hold
                sharesTraded = 0;
                break;
            case 'hold':
            default:
              console.log("Action: HOLD");
              sharesTraded = 0;
              break;
          }

        } catch (err: any) {
            console.error(`Error during simulation for day ${currentDateStr}:`, err);
            dayError = err.message || "An error occurred this day.";
            sharesTraded = 0; // Ensure sharesTraded is 0 if an error occurs before/during trade
        }

        // g. Calculate portfolio value using *current* day\'s closing price after trade execution
        // --- DEBUG LOGS START ---
        console.log(`-- Day ${currentDateStr} Pre-Value Calculation --`);
        console.log(`Cash: ${cash}`);
        console.log(`Shares Held: ${sharesHeld}`);
        console.log(`Current Price: ${currentPrice}`);
        // --- DEBUG LOGS END ---
        currentPortfolioValue = cash + sharesHeld * currentPrice;

        // Determine log details, adjusting for holding 0 shares
        let loggedAction = daySignal?.action;
        let loggedSharesTraded = sharesTraded;
        let loggedReason = daySignal?.reason;

        // Adjust sign for logging sells/shorts
        if (loggedAction === 'sell' || loggedAction === 'short') {
          loggedSharesTraded = -Math.abs(loggedSharesTraded); // Ensure it's negative
        } else {
          loggedSharesTraded = Math.abs(loggedSharesTraded); // Ensure it's positive for buy/cover
        }

        // --> EXISTING CONDITION <--
        // If the effective action is 'hold' but no shares are held, don't log 'hold'.
        if (loggedAction === 'hold' && sharesHeld === 0 && !dayError) {
          loggedAction = undefined; // Represent as no specific trading action
          loggedReason = loggedReason || "No position to hold.";
          loggedSharesTraded = 0; // No shares traded if holding with no position
        }

        // h. Add to simulationLog
        currentLog.push({
            date: currentDateStr,
            price: currentPrice,
            signal: daySignal?.signal,
            action: loggedAction, // Use potentially adjusted action
            sharesTraded: loggedSharesTraded,
            sharesHeld: sharesHeld,
            cash: cash,
            portfolioValue: currentPortfolioValue,
            reason: loggedReason, // Use potentially adjusted reason
            error: dayError,
        });

        setSimulationLog([...currentLog]); // Update log in UI after each day
      }

      // 4. Set final portfolio value (using the last available price)
      const finalPrice = historicalQuotes[historicalQuotes.length - 1].close;
      const finalValue = cash + sharesHeld * finalPrice;
      setFinalPortfolioValue(finalValue);
      console.log(`--- Simulation Complete ---`);
      console.log(`Initial Value: $${initialCash.toFixed(2)}`);
      console.log(`Final Value: $${finalValue.toFixed(2)}`);
      console.log(`Final Cash: $${cash.toFixed(2)}, Final Shares: ${sharesHeld}`);

    } catch (err: any) {
      console.error("Simulation failed:", err);
      setError(err.message || "An unexpected error occurred during simulation.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card className="max-w-3xl mx-auto">
      <CardHeader>
        <CardTitle>Trading Simulation</CardTitle>
        <CardDescription>
          Simulate AI trading decisions over a historical period.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-2">
            <label htmlFor="ticker" className="text-sm font-medium">Stock Ticker</label>
            <Input
              id="ticker"
              placeholder="e.g., AAPL, GOOGL"
              value={ticker}
              onChange={(e) => setTicker(e.target.value.toUpperCase())}
              disabled={isLoading}
              autoCapitalize="characters"
              className="uppercase"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="timeframe" className="text-sm font-medium">Timeframe (Days Back)</label>
            <Input
              id="timeframe"
              type="number"
              min="1"
              max="90" // Increased max timeframe slightly
              value={timeframe}
              onChange={(e) => setTimeframe(parseInt(e.target.value, 10) || 1)}
              disabled={isLoading}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="initialShares" className="text-sm font-medium">Initial Shares Held</label>
            <Input
              id="initialShares"
              type="number"
              min="0" // Can start with 0 shares
              value={initialShares}
              onChange={(e) => setInitialShares(parseInt(e.target.value, 10) || 0)}
              disabled={isLoading}
            />
          </div>
        </div>
        <Button
          onClick={handleRunSimulation}
          disabled={isLoading || !ticker.trim() || timeframe < 1 || initialShares < 0}
          className="w-full"
        >
          {isLoading ? "Running Simulation..." : "Run Simulation"}
        </Button>

        {isLoading && (
          <div className="mt-4 text-center text-sm text-muted-foreground">
            Simulation in progress... (This may take a moment per day)
          </div>
        )}

        {error && (
          <div className="mt-4 p-3 bg-destructive/10 text-destructive rounded-md text-sm">
            Error: {error}
          </div>
        )}

        {simulationLog.length > 0 && (
          <div className="mt-6 space-y-3">
            <h3 className="text-lg font-semibold">Simulation Log</h3>
            <div className="border rounded-md p-4 space-y-2 text-xs max-h-96 overflow-y-auto">
              {simulationLog.map((log, index) => (
                <details key={index} className="border-b pb-2 last:border-b-0 cursor-pointer">
                  <summary className="flex justify-between items-center hover:bg-muted/50 p-1 rounded">
                    <span>{log.date}</span>
                    <span className={`capitalize font-medium ${log.action === 'buy' ? 'text-green-600' : log.action === 'sell' ? 'text-red-600' : ''}`}>
                      {log.action || '-'}
                    </span>
                    <span>Value: ${log.portfolioValue.toFixed(2)}</span>
                  </summary>
                  <div className="mt-2 pl-4 space-y-1 text-muted-foreground">
                    {log.price !== null && <div>Price: ${log.price.toFixed(2)}</div>}
                    {log.signal && <div>Signal: <span className="capitalize">{log.signal}</span></div>}
                    {log.sharesTraded !== undefined && <div>Shares Traded: {log.sharesTraded}</div>}
                    <div>Shares Held: {log.sharesHeld}</div>
                    <div>Cash: ${log.cash.toFixed(2)}</div>
                    {log.reason && <div className="italic">Reason: {log.reason}</div>}
                    {log.error && <div className="text-destructive">Error: {log.error}</div>}
                  </div>
                </details>
              ))}
            </div>
            {finalPortfolioValue !== null && (
              <p className="text-md font-semibold text-center pt-2">
                Final Portfolio Value: ${finalPortfolioValue.toFixed(2)} {((
                  (finalPortfolioValue - initialCash) /
                  initialCash
                ) * 100).toFixed(2)}%)
              </p>
            )}
          </div>
        )}
      </CardContent>
      <CardFooter className="text-xs text-muted-foreground">
        Simulations use historical data and AI analysis for educational purposes.
        Market conditions, data availability, and AI responses can vary.
        Past performance is not indicative of future results.
      </CardFooter>
    </Card>
  );
} 