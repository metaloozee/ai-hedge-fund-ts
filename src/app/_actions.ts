"use server";

import { z } from "zod";
import { google } from "@ai-sdk/google";
import { convertToCoreMessages, generateObject, Message } from "ai";
import { tavily } from "@tavily/core";
import yahooFinance from "yahoo-finance2";

const tvly = tavily({ apiKey: process.env.TAVILY_API_KEY });

interface SearchResult {
  query: string;
  result: any;
  success: boolean;
}

interface SearchResultItem {
  title: string;
  url: string;
  content: string;
  score: number;
  published_date?: string;
  source?: string;
}

interface TavilySearchResponse {
  results: SearchResultItem[];
  images?: {
    url: string;
    title?: string;
    source?: string;
  }[];
}

interface NewsSearchResult extends SearchResult {
  result: TavilySearchResponse | null;
}

interface SocialSearchResult extends SearchResult {
  result: TavilySearchResponse | null;
}

interface FinanceSearchResult extends SearchResult {
  result: TavilySearchResponse | null;
}

export async function generateQueries(messages: Message[]) {
  try {
    const { object } = await generateObject({
      model: google("gemini-2.0-flash-001", { structuredOutputs: true }),
      schema: z.object({
        ticker: z.string(),
        recent_queries: z
          .array(z.string())
          .max(5)
          .describe(
            "Queries focused on the last 24-48 hours for immediate market-moving news"
          ),
        weekly_queries: z
          .array(z.string())
          .max(5)
          .describe(
            "Queries focused on the last 7 days for developing stories and short-term trends"
          ),
        monthly_queries: z
          .array(z.string())
          .max(5)
          .describe(
            "Queries focused on the last 30 days for baseline context and longer-term sentiment shifts"
          ),
      }),
      messages: convertToCoreMessages(messages),
      system: `
You are an AI assistant specialized in financial markets. Your task is to analyze the user's message, identify the stock ticker or company name mentioned, and generate three distinct sets of search queries for different timeframes.

- Extract the primary stock ticker symbol (e.g., AAPL, GOOGL, MSFT). If a company name is given, find its corresponding ticker.

- Generate up to 5 queries for the LAST 24-48 HOURS (recent_queries): 
  * Focus exclusively on very recent market-moving news
  * Target breaking news, earnings reports, analyst updates from the last day or two
  * These should identify information with highest impact on immediate price movements
  * Emphasize immediacy with terms like "today," "yesterday," "last 24 hours"

- Generate up to 5 queries for the LAST 7 DAYS (weekly_queries):
  * Focus on developing stories and context over the past week
  * Target weekend news that might affect Monday trading
  * Identify short-term trends emerging over the week
  * Use terms indicating recency but slightly broader, like "this week," "past few days"

- Generate up to 5 queries for the LAST 30 DAYS (monthly_queries):
  * Focus on major news events from the past month
  * Target longer-term sentiment shifts
  * Identify if recent news represents a change from the established narrative
  * Use broader time indicators like "this month," "recent weeks," "past 30 days"

Ensure all queries are precise, focused on the company/stock, and optimized for retrieving financial information relevant to trading decisions.
`,
    });

    console.log("Step 1", object);

    return {
      success: true,
      data: object,
    };
  } catch (e) {
    console.error(e);
    return {
      success: false,
      error: e instanceof Error ? e.message : "An error occurred",
    };
  }
}

export async function fetchData(
  ticker: string,
  recent_queries: string[],
  weekly_queries: string[],
  monthly_queries: string[]
): Promise<{
  success: boolean;
  data?: {
    ticker: string;
    stockData: any;
    recentResults: NewsSearchResult[];
    weeklyResults: SocialSearchResult[];
    monthlyResults: FinanceSearchResult[];
  };
  error?: string;
}> {
  try {
    const recentResults: NewsSearchResult[] = [];
    const weeklyResults: SocialSearchResult[] = [];
    const monthlyResults: FinanceSearchResult[] = [];

    // Process recent queries (last 24-48 hours) - highest priority for price movements
    await Promise.all(
      recent_queries.map(async (query) => {
        try {
          const res = await tvly.search(query, {
            topic: "news",
            time_range: "day", // Last 24 hours for most recent market-moving news
          });
          const dedupedResults = deduplicateSearchResults(
            res
          ) as TavilySearchResponse;
          recentResults.push({
            query,
            result: dedupedResults,
            success: true,
          });
        } catch (error) {
          recentResults.push({
            query,
            result: null,
            success: false,
          });
        }
      })
    );

    await Promise.all(
      weekly_queries.map(async (query) => {
        try {
          const res = await tvly.search(query, {
            topic: "general",
            time_range: "week",
          });
          const dedupedResults = deduplicateSearchResults(
            res
          ) as TavilySearchResponse;
          weeklyResults.push({
            query,
            result: dedupedResults,
            success: true,
          });
        } catch (error) {
          weeklyResults.push({
            query,
            result: null,
            success: false,
          });
        }
      })
    );

    await Promise.all(
      monthly_queries.map(async (query) => {
        try {
          const res = await tvly.search(query, {
            topic: "general",
            time_range: "month",
          });
          const dedupedResults = deduplicateSearchResults(
            res
          ) as TavilySearchResponse;
          monthlyResults.push({
            query,
            result: dedupedResults,
            success: true,
          });
        } catch (error) {
          monthlyResults.push({
            query,
            result: null,
            success: false,
          });
        }
      })
    );

    const stockData = await yahooFinance.chart(ticker, {
      period1: "2024-01-01",
      period2: new Date().toISOString().split("T")[0],
    });

    if (!stockData) {
      throw new Error("Stock data not found");
    }

    return {
      success: true,
      data: {
        ticker,
        stockData,
        recentResults,
        weeklyResults,
        monthlyResults,
      },
    };
  } catch (e) {
    console.error(e);
    return {
      success: false,
      error: e instanceof Error ? e.message : "An error occurred",
    };
  }
}

export async function sanitizeData(
  recentResults: NewsSearchResult[],
  weeklyResults: SocialSearchResult[],
  monthlyResults: FinanceSearchResult[]
) {
  try {
    const { object } = await generateObject({
      model: google("gemini-2.0-flash-001", { structuredOutputs: true }),
      schema: z.object({
        summary_analysis: z.array(z.string()),
      }),
      prompt: `
Analyze the following search results across three different timeframes:

PRIMARY TIMEFRAME - Last 24-48 hours (highest priority):
${JSON.stringify(recentResults)}

SECONDARY TIMEFRAME - Last 7 days (context):
${JSON.stringify(weeklyResults)}

BASELINE CONTEXT - Last 30 days (long-term trends):
${JSON.stringify(monthlyResults)}

Based *only* on the provided search results, follow this analysis methodology:

WEIGHTING AND PRIORITIZATION:
1. Give PRIMARY weight (70%) to the most recent information (last 24-48 hours) as this has the highest impact on immediate price movements.
2. Assign SECONDARY weight (20%) to the weekly data to provide context for developing stories and identify short-term trends.
3. Use the 30-day BASELINE data (10% weight) only for identifying longer-term sentiment shifts and determining if recent news represents a change in narrative.

ANALYSIS GUIDELINES:
1. Summarize the key breaking news and market-moving information from the last 24-48 hours.
2. Identify how the 7-day context either supports or conflicts with the very recent news.
3. Note any significant shifts in narrative when comparing recent news to the 30-day baseline.
4. Assess the general sentiment (positive, negative, neutral) across all timeframes, noting any changes.
5. Extract factual information most relevant to potential short-term price movements.
6. Identify recurring themes, major events, or significant opinions found in the data.

SYNTHESIS:
Synthesize these points into a concise analysis (\`summary_analysis\`) as an array of strings, with clear emphasis on the most recent data while using the other timeframes for context. Focus on information most critical for making near-term trading decisions. Avoid making predictions or giving financial advice.
      `,
    });

    if (!object) {
      throw new Error("Failed to analyze the stock data.");
    }

    return {
      success: true,
      data: object,
    };
  } catch (e) {
    console.error(e);
    return {
      success: false,
      error:
        e instanceof Error
          ? e.message
          : "An error occurred during data sanitization",
    };
  }
}

export async function generateSignals(summary_analysis: string[]) {
  try {
    const { object } = await generateObject({
      model: google("gemini-2.5-pro-exp-03-25", { structuredOutputs: true }),
      schema: z.object({
        signal: z.enum(["bullish", "bearish", "neutral"]),
        confidence: z.number().min(0).max(100),
        action: z.enum(["buy", "cover", "sell", "short", "hold"]),
        stocks: z
          .number()
          .min(0)
          .describe("The number of stocks to buy, sell, or short"),
        reason: z
          .string()
          .describe("A brief explanation for the signal and action"),
      }),
      prompt: `
You are an expert financial analyst AI. Based on the following summarized analysis derived from multiple timeframes, generate a trading signal.

The analysis was created using the following weighted approach:
- PRIMARY (70%): Information from the last 24-48 hours - highest impact on immediate price movements
- SECONDARY (20%): Data from the last 7 days - provides context for developing stories and short-term trends
- BASELINE (10%): Information from the last 30 days - offers perspective on longer-term sentiment shifts

Analysis:
${summary_analysis.join("\n")}

Generate an object with the following fields:
- \`signal\`: Your overall outlook (bullish, bearish, neutral).
- \`confidence\`: Your confidence level in this signal (0-100).
- \`action\`: The recommended trading action (buy, cover, sell, short, hold).
- \`stocks\`: A suggested number of stocks for the action (e.g., 100). Base this on a hypothetical portfolio or a standard risk unit, but keep it reasonable.
- \`reason\`: A concise explanation justifying your signal and action based *strictly* on the provided analysis points, with primary emphasis on the most recent information while acknowledging relevant context from longer timeframes.
`,
    });

    if (!object) {
      throw new Error("Couldn't generate final signal for the stock");
    }

    return {
      success: true,
      data: object,
    };
  } catch (error) {
    console.error(error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "An error occurred",
    };
  }
}

function normalizeUrl(url: string): string {
  try {
    return url
      .trim()
      .toLowerCase()
      .replace(/\/$/, "")
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "");
  } catch {
    return url;
  }
}

function deduplicateSearchResults(searchResults: any): TavilySearchResponse {
  if (
    !searchResults ||
    !searchResults.results ||
    !Array.isArray(searchResults.results)
  ) {
    return searchResults as TavilySearchResponse;
  }

  const seenUrls = new Set<string>();
  const dedupedResults = { ...searchResults } as TavilySearchResponse;

  if (dedupedResults.results) {
    dedupedResults.results = dedupedResults.results.filter(
      (result: SearchResultItem) => {
        if (!result || !result.url) return true;

        const url = normalizeUrl(result.url);
        if (seenUrls.has(url)) {
          return false;
        }

        seenUrls.add(url);
        return true;
      }
    );
  }

  if (dedupedResults.images && Array.isArray(dedupedResults.images)) {
    const seenImageUrls = new Set<string>();

    dedupedResults.images = dedupedResults.images.filter((image) => {
      if (!image || !image.url) return true;

      const url = normalizeUrl(image.url);
      if (seenImageUrls.has(url)) {
        return false;
      }

      seenImageUrls.add(url);
      return true;
    });
  }

  return dedupedResults;
}
