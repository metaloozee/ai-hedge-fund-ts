"use client";

import { useState, FormEvent } from "react";
import {
  fetchData,
  generateQueries,
  generateSignals,
  sanitizeData,
  validateTicker,
} from "@/app/_actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { TextShimmer } from "@/components/ui/text-shimmer";
import MarkdownRenderer from "./MarkdownRenderer";

interface StockSignal {
  signal: "bullish" | "bearish" | "neutral";
  confidence: number;
  action: "buy" | "cover" | "sell" | "short" | "hold";
  stocks: number;
  reason: string;
}

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

interface ValidateResult {
  success: boolean;
  ticker?: string;
  error?: string;
}

export default function HedgeFundAnalysis() {
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<StockSignal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState<string>("idle");
  const [tickerInput, setTickerInput] = useState<string>("");
  const [stockData, setStockData] = useState<{
    ticker: string;
    price: number;
    chartData: any[];
    priceChange: number;
    firstClose: number;
  } | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTickerInput(e.target.value.toUpperCase());
  };

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const tickerToValidate = tickerInput.trim();
    if (!tickerToValidate) return;

    setIsLoading(true);
    setError(null);
    setResults(null);
    setStockData(null);
    setCurrentStep(`Validating ticker: ${tickerToValidate}...`);

    validateTicker(tickerToValidate)
      .then((validateResult: ValidateResult) => {
        if (!validateResult.success || !validateResult.ticker) {
          throw new Error(validateResult.error || "Invalid ticker symbol");
        }
        const validatedTickerString = validateResult.ticker;

        setCurrentStep(`Generating queries for ${validatedTickerString}...`);
        return generateQueries(validatedTickerString)
          .then((queriesResult: QueryResult) => {
            if (!queriesResult.success || !queriesResult.data) {
              throw new Error(queriesResult.error || "Failed to generate queries");
            }
            return { validatedTicker: validatedTickerString, queriesResult };
          });
      })
      .then(({ validatedTicker, queriesResult }: { validatedTicker: string, queriesResult: QueryResult }) => {
        setCurrentStep(`Fetching stock and market data for ${validatedTicker}...`);
        const { recent_queries, weekly_queries, monthly_queries } = queriesResult.data!;
        return fetchData(
          validatedTicker,
          recent_queries,
          weekly_queries,
          monthly_queries
        ).then((fetchResult) => ({ validatedTicker, fetchResult }));
      })
      .then(({ validatedTicker, fetchResult }: { validatedTicker: string, fetchResult: FetchResult }) => {
        if (!fetchResult.success || !fetchResult.data) {
          throw new Error(fetchResult.error || "Failed to fetch data");
        }

        const {
          stockData,
          recentResults,
          weeklyResults,
          monthlyResults,
        } = fetchResult.data;

        const lastQuote = stockData.quotes[stockData.quotes.length - 1];
        const firstQuote = stockData.quotes[0];
        const currentPrice = lastQuote.close;
        const firstPrice = firstQuote.close;
        const priceChange = currentPrice - firstPrice;

        const chartData = stockData.quotes.map((quote: any) => ({
          date: new Date(quote.date).toLocaleDateString(),
          price: quote.close,
          fullDate: quote.date,
        }));

        setStockData({
          ticker: validatedTicker,
          price: currentPrice,
          chartData,
          priceChange,
          firstClose: firstPrice,
        });

        setCurrentStep("Analyzing the data...");
        return sanitizeData(
          recentResults,
          weeklyResults,
          monthlyResults
        );
      })
      .then((sanitizeResult: SanitizeResult) => {
        if (!sanitizeResult.success || !sanitizeResult.data) {
          throw new Error(sanitizeResult.error || "Failed to sanitize data");
        }

        setCurrentStep("Generating trading signals...");
        return generateSignals(sanitizeResult.data.summary_analysis);
      })
      .then((signalsResult: SignalResult) => {
        if (!signalsResult.success || !signalsResult.data) {
          throw new Error(signalsResult.error || "Failed to generate signals");
        }

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
              <label htmlFor="ticker" className="text-sm font-medium">
                Enter Stock Ticker:
              </label>
              <Input
                id="ticker"
                placeholder="e.g., AAPL, GOOGL, MSFT"
                value={tickerInput}
                onChange={handleChange}
                disabled={isLoading}
                autoCapitalize="characters"
                className="uppercase"
              />
            </div>
            <Button
              type="submit"
              disabled={isLoading || !tickerInput.trim()}
              className="w-full"
            >
              {isLoading ? "Analyzing..." : "Analyze"}
            </Button>
          </form>

          {isLoading && (
            <div className="mt-6 text-left text-xs">
              <TextShimmer>{currentStep}</TextShimmer>
            </div>
          )}

          {error && (
            <div className="mt-6 p-4 bg-destructive/10 text-destructive rounded-md">
              {error}
            </div>
          )}

          {stockData && (
            <div className="mt-6 space-y-4">
              <div className="p-4 rounded-md bg-card border">
                <div className="flex flex-col items-start justify-between mb-4">
                  <h3 className="text-sm text-muted-foreground">
                    {stockData.ticker}

                    <span className="text-xs ml-2">
                      {stockData.priceChange >= 0 ? "+" : ""}
                      {stockData.priceChange.toFixed(2)}(
                      {(
                        (stockData.priceChange / stockData.firstClose) *
                        100
                      ).toFixed(2)}
                      %)
                    </span>
                  </h3>
                  <span
                    className={`text-xl font-bold ${
                      stockData.priceChange >= 0
                        ? "text-green-500"
                        : "text-red-500"
                    }`}
                  >
                    ${stockData.price.toFixed(2)}
                  </span>
                </div>

                <ChartContainer
                  config={{
                    price: {
                      label: "Price",
                      color:
                        stockData.priceChange >= 0
                          ? "hsl(142, 76%, 36%)"
                          : "hsl(0, 84%, 60%)",
                    },
                  }}
                  className="h-[30vh] w-full"
                >
                  <AreaChart data={stockData.chartData}>
                    <defs>
                      <linearGradient
                        id="colorPrice"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="5%"
                          stopColor={
                            stockData.priceChange >= 0
                              ? "hsl(142, 76%, 36%)"
                              : "hsl(0, 84%, 60%)"
                          }
                          stopOpacity={0.8}
                        />
                        <stop
                          offset="95%"
                          stopColor={
                            stockData.priceChange >= 0
                              ? "hsl(142, 76%, 36%)"
                              : "hsl(0, 84%, 60%)"
                          }
                          stopOpacity={0}
                        />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.3} />
                    {/* 
                    <XAxis 
                      dataKey="date"
                      tickLine={false}
                      axisLine={false}
                      tickMargin={8}
                      tickCount={2}
                      minTickGap={1}
                      domain={['dataMin', 'dataMax']}
                      tickFormatter={(value, index) => {
                        if (index === 0) return stockData.chartData[0]?.date || "";
                        return stockData.chartData[stockData.chartData.length - 1]?.date || "";
                      }}
                    />
                    */}
                    {/* <YAxis 
                      tickLine={false}
                      axisLine={false}
                      tickMargin={8}
                      tickFormatter={(value) => `$${value}`}
                    /> */}
                    <ChartTooltip
                      content={<ChartTooltipContent />}
                      cursor={{
                        stroke: "var(--border)",
                        strokeWidth: 1,
                        strokeDasharray: "4 4",
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="price"
                      stroke={
                        stockData.priceChange >= 0
                          ? "hsl(142, 76%, 36%)"
                          : "hsl(0, 84%, 60%)"
                      }
                      strokeWidth={2}
                      fillOpacity={1}
                      fill="url(#colorPrice)"
                    />
                  </AreaChart>
                </ChartContainer>
              </div>
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
                  {results.signal.charAt(0).toUpperCase() +
                    results.signal.slice(1)}{" "}
                  Signal
                  <span className="font-normal text-sm text-muted-foreground ml-auto">
                    {results.confidence}% confidence
                  </span>
                </h3>
                <p className="text-base font-medium mb-1">
                  Recommended Action:{" "}
                  <span className="capitalize">{results.action}</span>{" "}
                  {results.stocks} stocks
                </p>
                <MarkdownRenderer content={results.reason} />
              </div>
            </div>
          )}
        </CardContent>
        <CardFooter className="text-xs text-muted-foreground">
          This analysis is for educational purposes only and should not be
          considered financial advice.
        </CardFooter>
      </Card>
    </div>
  );
}
