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

export async function generateQueries(ticker: string) {
  try {
    const { object } = await generateObject({
      model: google("gemini-2.0-flash-001", { structuredOutputs: true }),
      schema: z.object({
        recent_queries: z
          .array(z.string())
          .max(5)
          .describe(
            "Queries focused on the last 24-48 hours for immediate market-moving news (e.g., earnings, analyst ratings, M&A rumors)"
          ),
        weekly_queries: z
          .array(z.string())
          .max(5)
          .describe(
            "Queries focused on the last 7 days for developing stories, short-term trends, and competitor news"
          ),
        monthly_queries: z
          .array(z.string())
          .max(5)
          .describe(
            "Queries focused on the last 30 days for baseline context, regulatory changes, and longer-term sentiment shifts"
          ),
      }),
      prompt: `
You are an expert financial market AI assistant. Your goal is to generate highly relevant search queries for the stock ticker: ${ticker}.

Generate three distinct sets of search queries optimized for financial news APIs, covering different timeframes:

- **Recent (24-48 Hours - \`recent_queries\`, max 5):**
  * Focus: Immediate, high-impact news for ${ticker}.
  * Target: Breaking news, earnings releases/calls, significant analyst rating changes, M&A activity, major partnership announcements, unexpected events impacting ${ticker} directly.
  * Keywords: Use terms implying immediacy ("today", "yesterday", "last 24 hours", "breaking news ${ticker}").
  * Goal: Identify information critical for near-term price action for ${ticker}.

- **Weekly (Last 7 Days - \`weekly_queries\`, max 5):**
  * Focus: Developing narratives and context for ${ticker}.
  * Target: Follow-ups to recent news, competitor news impacting ${ticker}, sector trends affecting ${ticker}, weekend news relevant to Monday trading.
  * Keywords: Use terms indicating the past week ("this week", "past few days", "last 7 days ${ticker}").
  * Goal: Understand the short-term trend and evolving story around ${ticker}.

- **Monthly (Last 30 Days - \`monthly_queries\`, max 5):**
  * Focus: Broader context and longer-term sentiment for ${ticker}.
  * Target: Major news events, significant product launches, regulatory news impacting the industry/ ${ticker}, shifts in overall market sentiment towards ${ticker}.
  * Keywords: Use broader terms ("this month", "past 30 days", "recent weeks ${ticker}").
  * Goal: Establish a baseline understanding and identify potential shifts from the longer-term narrative for ${ticker}.

**Instructions:**
- Ensure all queries are specific to ${ticker}.
- Phrase queries as if you were searching a financial news database (e.g., "Apple Q2 earnings results", "Nvidia analyst rating changes today").
- Generate queries likely to yield actionable, factual information for trading decisions. Avoid vague queries.
`,
    });

    console.log("Step 1: Generated Queries for", ticker, object);

    return {
      success: true,
      data: {
        ticker,
        ...object,
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
      model: google("gemini-2.5-pro-exp-03-25", { structuredOutputs: true }),
      schema: z.object({
        summary_analysis: z.array(z.string()).describe("Array of concise bullet points summarizing the key findings and analysis."),
      }),
      prompt: `
You are a financial analyst AI tasked with synthesizing search results about a specific stock. Analyze the provided data across three timeframes, adhering strictly to the specified weighting and methodology.

**Search Results Data:**

*   **PRIMARY TIMEFRAME (Last 24-48 hours):** High-impact, recent news.
    \`\`\`json
    ${JSON.stringify(recentResults)}
    \`\`\`
*   **SECONDARY TIMEFRAME (Last 7 days):** Context and developing stories.
    \`\`\`json
    ${JSON.stringify(weeklyResults)}
    \`\`\`
*   **BASELINE CONTEXT (Last 30 days):** Longer-term trends and narrative.
    \`\`\`json
    ${JSON.stringify(monthlyResults)}
    \`\`\`

**Analysis Methodology (Based *only* on provided data):**

1.  **Weighting:**
    *   **70% Weight:** PRIMARY (24-48 hours) - Most critical for immediate price movement.
    *   **20% Weight:** SECONDARY (7 days) - Context for recent news and short-term trends.
    *   **10% Weight:** BASELINE (30 days) - Identifying narrative shifts vs. long-term trends.

2.  **Analysis Guidelines:**
    *   **Identify Key Recent News:** Extract the most significant market-moving facts from the PRIMARY timeframe.
    *   **Contextualize:** Does the SECONDARY data support, contradict, or add nuance to the PRIMARY findings? Note any developing stories.
    *   **Baseline Comparison:** Does the recent news (PRIMARY/SECONDARY) represent a shift from the BASELINE narrative or sentiment?
    *   **Sentiment Assessment:** Assess the dominant sentiment (positive, negative, neutral) for each timeframe. Note changes or conflicts in sentiment. Quantify if possible (e.g., "overwhelmingly negative," "slightly positive").
    *   **Extract Actionable Facts:** Focus on concrete information (e.g., specific financial figures, event outcomes, analyst price targets) relevant to short-term trading decisions.
    *   **Identify Themes/Events:** Note recurring topics, major events (e.g., earnings calls, product launches), or influential opinions mentioned across the results.
    *   **Note Contradictions:** Explicitly point out any conflicting information found between or within timeframes.

3.  **Synthesis (\`summary_analysis\`):**
    *   Produce a concise summary as an **array of strings**. Each string should represent a key finding or bullet point from your analysis.
    *   **Prioritize** findings from the PRIMARY timeframe, using SECONDARY and BASELINE data for context and comparison.
    *   Focus *exclusively* on information present in the search results.
    *   **Do NOT** add external knowledge, opinions, predictions, or financial advice.
    *   Structure the output clearly, perhaps grouping points by theme (e.g., Recent Earnings, Analyst Actions, Sentiment Trend).

Generate the \`summary_analysis\` array based on this methodology.
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
        confidence: z.number().min(0).max(100).describe("Confidence level (0-100) based on the clarity, consistency, and strength of evidence in the analysis."),
        action: z.enum(["buy", "cover", "sell", "short", "hold"]),
        stocks: z
          .number()
          .min(0)
          .int()
          .describe("Suggested number of stocks for the action (e.g., 100). Scale based on confidence and hypothetical standard risk unit (e.g., higher confidence = potentially higher number). Keep reasonable."),
        reason: z
          .string()
          .describe("Concise explanation justifying the signal and action, directly referencing specific points from the provided summary_analysis."),
      }),
      prompt: `
You are an expert financial analyst AI. Your task is to generate a trading signal based *strictly* on the provided \`summary_analysis\`.

**Analysis Context:**
The provided analysis was synthesized from search results using a weighted approach:
- PRIMARY (70%): Last 24-48 hours (immediate impact)
- SECONDARY (20%): Last 7 days (context/trends)
- BASELINE (10%): Last 30 days (long-term narrative)

**Analysis Summary:**
\`\`\`
${summary_analysis.join("\n- ")}
\`\`\`

**Task:** Generate a trading signal object with the following fields:

- **\`signal\` (enum: "bullish", "bearish", "neutral"):** Determine the overall directional outlook based *solely* on the analysis.
- **\`confidence\` (number 0-100):** Assess your confidence in the signal. Higher confidence requires clear, consistent, and strong evidence in the analysis, especially from the primary timeframe. Lower confidence reflects conflicting data, weak evidence, or neutral overall findings.
- **\`action\` (enum: "buy", "cover", "sell", "short", "hold"):** Choose the most logical trading action corresponding to the signal and confidence.
    - Bullish: 'buy' (or 'cover' if closing a short)
    - Bearish: 'sell' (if holding) or 'short' (to initiate)
    - Neutral or Low Confidence: 'hold'
- **\`stocks\` (integer):** Suggest a *hypothetical* number of shares for the action. Base this on a standard risk unit concept. Consider scaling this number relative to your confidence level (e.g., 100 for moderate confidence, 200 for high, 50 for low but actionable, 0 for hold). Keep the number reasonable for a typical trade.
- **\`reason\` (string):** Provide a concise justification. **Crucially, link your signal, confidence, and action *directly* back to specific key findings mentioned in the \`summary_analysis\`**. Explain *why* those specific points lead to your conclusion, respecting the weighted importance of the timeframes.

**Constraints:**
- Base your entire output *only* on the provided \`summary_analysis\`. Do not use external data or make assumptions.
- Do not give financial advice beyond generating the structured signal based on the input.
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

export async function validateTicker(ticker: string): Promise<{ success: boolean; ticker?: string; error?: string }> {
  try {
    const searchResult = await yahooFinance.search(ticker);

    if (searchResult && searchResult.quotes && searchResult.quotes.length > 0) {
      const exactMatch = searchResult.quotes.find(
        (quote): quote is { symbol: string } & typeof quote =>
          quote && 'symbol' in quote && typeof quote.symbol === 'string' && quote.symbol === ticker
      );

      if (exactMatch && exactMatch.symbol) {
        return { success: true, ticker: exactMatch.symbol };
      } else {
        const suggestedSymbols = searchResult.quotes
          .filter((quote): quote is { symbol: string } & typeof quote =>
            quote && 'symbol' in quote && typeof quote.symbol === 'string'
          )
          .map((q) => q.symbol) 
          .slice(0, 3)
          .join(', ');

        const errorMessage = suggestedSymbols
          ? `Ticker symbol "${ticker}" not found. Did you mean one of these: ${suggestedSymbols}?`
          : `Ticker symbol "${ticker}" not found. No similar symbols were identified.`;

        return { success: false, error: errorMessage };
      }
    } else {
      return { success: false, error: `No results found for ticker symbol: ${ticker}` };
    }
  } catch (error) {
    console.error(`Validation failed for ticker "${ticker}":`, error);
    if (error instanceof Error && (error.message.includes("Not Found") || error.message.includes("Failed to fetch"))) {
       return { success: false, error: `Error searching for ticker symbol: ${ticker}` };
    }
    return { success: false, error: "Failed to validate ticker due to an unexpected error." };
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
