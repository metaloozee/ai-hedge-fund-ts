"use client";

import { useState, FormEvent } from "react";
import { Message } from "ai";
import { fetchData, generateQueries, generateSignals, sanitizeData } from "@/app/_actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

interface StockSignal {
  signal: "bullish" | "bearish" | "neutral";
  confidence: number;
  action: "buy" | "cover" | "sell" | "short" | "hold";
  stocks: number;
  reason: string;
}

// Define types for our server action results
interface QueryResult {
  success: boolean;
  data?: {
    ticker: string;
    recent_queries: string[];
    weekly_queries: string[];
    monthly_queries: string[];
  };
  error?: string;
}

interface FetchResult {
  success: boolean;
  data?: {
    ticker: string;
    stockData: any;
    recentResults: any[];
    weeklyResults: any[];
    monthlyResults: any[];
  };
  error?: string;
}

interface SanitizeResult {
  success: boolean;
  data?: {
    summary_analysis: string[];
  };
  error?: string;
}

interface SignalResult {
  success: boolean;
  data?: StockSignal;
  error?: string;
}

export default function HedgeFundAnalysis() {
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<StockSignal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState<string>("idle");
  const [query, setQuery] = useState<string>("");

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
  };

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!query.trim()) return;
    
    setIsLoading(true);
    setError(null);
    setResults(null);
    setCurrentStep("Generating queries...");

    // Create a message object from the query
    const message: Message = { id: crypto.randomUUID(), role: "user", content: query };

    // First step: Generate queries from the message
    generateQueries([message])
      .then((queriesResult: QueryResult) => {
        if (!queriesResult.success || !queriesResult.data) {
          throw new Error(queriesResult.error || "Failed to generate queries");
        }
        
        // Second step: Fetch data based on the generated queries
        setCurrentStep("Fetching stock and market data...");
        const { ticker, recent_queries, weekly_queries, monthly_queries } = queriesResult.data;
        return fetchData(ticker, recent_queries, weekly_queries, monthly_queries)
          .then(fetchResult => ({ queriesResult, fetchResult }));
      })
      .then(({ queriesResult, fetchResult }: { queriesResult: QueryResult, fetchResult: FetchResult }) => {
        if (!fetchResult.success || !fetchResult.data) {
          throw new Error(fetchResult.error || "Failed to fetch data");
        }
        
        // Third step: Sanitize the fetched data
        setCurrentStep("Analyzing the data...");
        const { recentResults, weeklyResults, monthlyResults } = fetchResult.data;
        return sanitizeData(recentResults, weeklyResults, monthlyResults)
          .then(sanitizeResult => ({ 
            queriesResult, 
            fetchResult, 
            sanitizeResult 
          }));
      })
      .then(({ sanitizeResult }: { sanitizeResult: SanitizeResult }) => {
        if (!sanitizeResult.success || !sanitizeResult.data) {
          throw new Error(sanitizeResult.error || "Failed to sanitize data");
        }
        
        // Final step: Generate trading signals based on the analysis
        setCurrentStep("Generating trading signals...");
        return generateSignals(sanitizeResult.data.summary_analysis);
      })
      .then((signalsResult: SignalResult) => {
        if (!signalsResult.success || !signalsResult.data) {
          throw new Error(signalsResult.error || "Failed to generate signals");
        }
        
        // Set the final results
        setResults(signalsResult.data);
        setCurrentStep("completed");
      })
      .catch((err: Error) => {
        console.error(err);
        setError(err.message || "An error occurred during analysis");
        setCurrentStep("error");
      })
      .finally(() => {
        setIsLoading(false);
      });
  };

  return (
    <div className="max-w-3xl mx-auto">
      <Card>
        <CardHeader>
          <CardTitle>Stock Analysis</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="flex flex-col space-y-2">
              <label htmlFor="query" className="text-sm font-medium">
                What stock would you like to analyze?
              </label>
              <Input
                id="query"
                placeholder="e.g., Tell me about AAPL stock performance and future outlook"
                value={query}
                onChange={handleChange}
                disabled={isLoading}
              />
            </div>
            <Button type="submit" disabled={isLoading || !query.trim()} className="w-full">
              {isLoading ? "Analyzing..." : "Analyze"}
            </Button>
          </form>

          {isLoading && (
            <div className="mt-6 text-center">
              <div className="animate-pulse">{currentStep}</div>
            </div>
          )}

          {error && (
            <div className="mt-6 p-4 bg-destructive/10 text-destructive rounded-md">
              {error}
            </div>
          )}

          {results && (
            <div className="mt-6 space-y-4">
              <div className="p-4 rounded-md bg-card border">
                <h3 className="font-semibold text-lg mb-2 flex items-center gap-2">
                  <span 
                    className={`inline-block w-3 h-3 rounded-full ${
                      results.signal === "bullish" 
                        ? "bg-green-500" 
                        : results.signal === "bearish" 
                        ? "bg-red-500" 
                        : "bg-yellow-500"
                    }`} 
                  />
                  {results.signal.charAt(0).toUpperCase() + results.signal.slice(1)} Signal
                  <span className="font-normal text-sm text-muted-foreground ml-auto">
                    {results.confidence}% confidence
                  </span>
                </h3>
                <p className="text-base font-medium mb-1">
                  Recommended Action: <span className="capitalize">{results.action}</span> {results.stocks} stocks
                </p>
                <p className="text-sm text-muted-foreground">{results.reason}</p>
              </div>
            </div>
          )}
        </CardContent>
        <CardFooter className="text-xs text-muted-foreground">
          This analysis is for educational purposes only and should not be considered financial advice.
        </CardFooter>
      </Card>
    </div>
  );
}
