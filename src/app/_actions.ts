"use server";

import { z } from "zod";
import { google } from "@ai-sdk/google";
import { convertToCoreMessages, generateObject, Message } from "ai";
import { tavily } from "@tavily/core";
import yahooFinance from "yahoo-finance2";
import { openrouter } from "@openrouter/ai-sdk-provider"

const tvly = tavily({ apiKey: process.env.TAVILY_API_KEY });

const largeModel = openrouter("google/gemini-2.5-pro-exp-03-25:free")

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

interface HistoricalQuote {
  date: Date;
  close: number;
}

interface HistoricalStockData {
  quotes: HistoricalQuote[];
  error?: string;
}

interface NewsSearchResult extends SearchResult {
  result: TavilySearchResponse | null;
  success: boolean;
}

interface SocialSearchResult extends SearchResult {
  result: TavilySearchResponse | null;
}

interface FinanceSearchResult extends SearchResult {
  result: TavilySearchResponse | null;
}

export async function generateQueries(ticker: string, simulationDate?: Date) {
  try {
    const dateContext = simulationDate
      ? `as of the end of ${simulationDate.toLocaleDateString()}`
      : "based on the latest available data";

    const timeConstraints = simulationDate
      ? ` Crucially, queries MUST be phrased to find information that would have been *knowable before* the end of ${simulationDate.toLocaleDateString()}. Do not ask about events *on* or *after* this date.`
      : "";

    const { object } = await generateObject({
      model: largeModel,
      schema: z.object({
        recent_queries: z
          .array(z.string())
          .max(5)
          .describe(
            "Queries for high-impact news (24-48 hours prior). Examples: earnings releases, major analyst changes, M&A."
          ),
        weekly_queries: z
          .array(z.string())
          .max(5)
          .describe(
            "Queries for developing stories (7 days prior). Examples: follow-up news, competitor actions, sector trends."
          ),
        monthly_queries: z
          .array(z.string())
          .max(5)
          .describe(
            "Queries for broader context (30 days prior). Examples: regulatory changes, product launches, sentiment shifts."
          ),
      }),
      prompt: `
You are an expert financial market AI assistant specializing in crafting precise search queries for financial news APIs (like Tavily).
Your goal is to generate highly relevant search queries for the stock ticker: ${ticker}, focusing on information available ${dateContext}.

Generate three distinct sets of search queries, optimized for fact-finding and covering different timeframes relative to ${dateContext}:

- **Recent (Up to 48 Hours Prior - \`recent_queries\`, max 5):**
  * Focus: Immediate, significant market-moving *facts* for ${ticker} leading up to ${dateContext}.
  * Target: Confirmed earnings results, official analyst rating changes, M&A announcements, significant partnerships, major product news, unexpected factual events impacting ${ticker}.
  * Keywords: Use precise terms implying confirmed events *before* the date ("${ticker} earnings announced before ${simulationDate?.toLocaleDateString()}", "analyst upgrades ${ticker} prior to ${simulationDate?.toLocaleDateString()}"). Avoid speculative language.
  * Goal: Identify factual, high-impact information critical for near-term price action perception ${dateContext}.

- **Weekly (Up to 7 Days Prior - \`weekly_queries\`, max 5):**
  * Focus: Developing factual narratives and context for ${ticker} in the week preceding ${dateContext}.
  * Target: Follow-ups to recent news, factual competitor news impacting ${ticker}, relevant sector developments, important industry news.
  * Keywords: Frame queries for the week leading up to the date ("${ticker} sector news week ending ${simulationDate?.toLocaleDateString()}", "${ticker} competitor results prior to ${simulationDate?.toLocaleDateString()}").
  * Goal: Understand the verified short-term trend and evolving story around ${ticker} up to ${dateContext}.

- **Monthly (Up to 30 Days Prior - \`monthly_queries\`, max 5):**
  * Focus: Broader factual context and established sentiment for ${ticker} in the month preceding ${dateContext}.
  * Target: Major confirmed news events (product launches, regulatory decisions), significant management changes, established market sentiment shifts towards ${ticker}.
  * Keywords: Use broader but still factual terms ("${ticker} major product launch announced month ending ${simulationDate?.toLocaleDateString()}", "regulatory news affecting ${ticker} prior to ${simulationDate?.toLocaleDateString()}").
  * Goal: Establish a factual baseline and identify shifts from the longer-term narrative for ${ticker} leading into ${dateContext}.

**Instructions:**
- Ensure all queries are specific to ${ticker}.
- Phrase queries precisely for a financial news search engine, seeking *confirmed facts* or *reported events* available ${dateContext}.
- Aim for queries likely to yield actionable, factual information (e.g., numbers, announcements, specific ratings). Avoid vague or purely sentiment-based queries (e.g., "Is ${ticker} a good buy?").
- ${timeConstraints}
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
  monthly_queries: string[],
  simulationDate?: Date
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

    const searchOptionsBase = simulationDate
      ? { search_depth: "advanced" as const }
      : {};

    const recentEndDate = simulationDate ? simulationDate : new Date();
    const recentStartDate = new Date(recentEndDate);
    recentStartDate.setDate(recentEndDate.getDate() - 2);

    await Promise.all(
      recent_queries.map(async (query) => {
        try {
          const options = {
            ...searchOptionsBase,
            topic: "news" as const,
            ...(simulationDate && {
              max_results: 7,
            }),
          };
          const res = await tvly.search(query, options);
          const dedupedResults = deduplicateSearchResults(
            res
          ) as TavilySearchResponse;
          recentResults.push({
            query,
            result: filterResultsByDate(
              dedupedResults,
              recentStartDate,
              recentEndDate
            ),
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

    const weeklyEndDate = simulationDate ? simulationDate : new Date();
    const weeklyStartDate = new Date(weeklyEndDate);
    weeklyStartDate.setDate(weeklyEndDate.getDate() - 7);

    await Promise.all(
      weekly_queries.map(async (query) => {
        try {
          const options = {
            ...searchOptionsBase,
            topic: "general" as const,
            ...(simulationDate && {
              max_results: 7,
            }),
          };
          const res = await tvly.search(query, options);
          const dedupedResults = deduplicateSearchResults(
            res
          ) as TavilySearchResponse;
          weeklyResults.push({
            query,
            result: filterResultsByDate(
              dedupedResults,
              weeklyStartDate,
              weeklyEndDate
            ),
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

    const monthlyEndDate = simulationDate ? simulationDate : new Date();
    const monthlyStartDate = new Date(monthlyEndDate);
    monthlyStartDate.setDate(monthlyEndDate.getDate() - 30);

    await Promise.all(
      monthly_queries.map(async (query) => {
        try {
          const options = {
            ...searchOptionsBase,
            topic: "general" as const,
            ...(simulationDate && {
              max_results: 7,
            }),
          };
          const res = await tvly.search(query, options);
          const dedupedResults = deduplicateSearchResults(
            res
          ) as TavilySearchResponse;
          monthlyResults.push({
            query,
            result: filterResultsByDate(
              dedupedResults,
              monthlyStartDate,
              monthlyEndDate
            ),
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

    let stockDataResult;
    if (simulationDate) {
      const simStartDate = new Date(simulationDate);
      simStartDate.setDate(simulationDate.getDate() - 1);
      const simEndDate = new Date(simulationDate);
      simEndDate.setDate(simulationDate.getDate() + 1);

      stockDataResult = await yahooFinance.chart(ticker, {
        period1: simStartDate.toISOString().split("T")[0],
        period2: simEndDate.toISOString().split("T")[0],
      });
    } else {
      stockDataResult = await yahooFinance.chart(ticker, {
        period1: "2024-01-01",
        period2: new Date().toISOString().split("T")[0],
      });
    }

    if (!stockDataResult) {
      throw new Error(
        `Stock data not found for ${ticker}${
          simulationDate ? ` around ${simulationDate.toLocaleDateString()}` : ""
        }`
      );
    }

    return {
      success: true,
      data: {
        ticker,
        stockData: stockDataResult,
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

export async function fetchHistoricalStockData(
  ticker: string,
  startDate: Date,
  endDate: Date
): Promise<HistoricalStockData> {
  try {
    console.log(
      `Fetching historical data for ${ticker} from ${
        startDate.toISOString().split("T")[0]
      } to ${endDate.toISOString().split("T")[0]}`
    );
    const result = await yahooFinance.chart(ticker, {
      period1: startDate.toISOString().split("T")[0],
      period2: endDate.toISOString().split("T")[0],
      interval: "1d",
    });

    if (!result || !result.quotes || result.quotes.length === 0) {
      console.warn(
        `No historical quotes found for ${ticker} in the specified range.`
      );
      return { quotes: [], error: `No historical quotes found for ${ticker}` };
    }

    const quotes: HistoricalQuote[] = result.quotes
      .map((q: any) => {
        if (
          !q ||
          typeof q.date === "undefined" ||
          typeof q.close !== "number"
        ) {
          console.warn("Skipping invalid quote entry:", q);
          return null;
        }
        const date = new Date(q.date);
        const close = q.close;

        if (isNaN(date.getTime())) {
          console.warn("Skipping quote with invalid date:", q);
          return null;
        }

        return {
          ...q,
          date: date,
          close: close,
        };
      })
      .filter((q): q is HistoricalQuote => q !== null)
      .sort(
        (a: HistoricalQuote, b: HistoricalQuote) =>
          a.date.getTime() - b.date.getTime()
      );

    console.log(
      `Successfully fetched ${quotes.length} historical quotes for ${ticker}.`
    );
    return { quotes };
  } catch (error) {
    console.error(
      `Failed to fetch historical stock data for ${ticker}:`,
      error
    );
    const errorMessage =
      error instanceof Error ? error.message : "An unknown error occurred";
    return {
      quotes: [],
      error: `Failed to fetch historical data: ${errorMessage}`,
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
      model: largeModel,
      schema: z.object({
        summary_analysis: z
          .array(z.string())
          .max(10)
          .describe(
            "Array of concise bullet points (max 10 total) summarizing key findings and analysis based *only* on provided data."
          ),
      }),
      prompt: `
You are a financial data synthesis AI. Your task is to analyze and synthesize search results about a specific stock, adhering strictly to the provided data and methodology.

**Input Search Results Data:**

*   **PRIMARY (70% Weight - Last 24-48 hours):** High-impact, recent news. Crucial for immediate assessment.
    \`\`\`json
    ${JSON.stringify(recentResults)}
    \`\`\`
*   **SECONDARY (20% Weight - Last 7 days):** Context and developing stories. Provides short-term trend context.
    \`\`\`json
    ${JSON.stringify(weeklyResults)}
    \`\`\`
*   **BASELINE (10% Weight - Last 30 days):** Longer-term trends and narrative. Used for comparison and identifying shifts.
    \`\`\`json
    ${JSON.stringify(monthlyResults)}
    \`\`\`

**Analysis Methodology (Based *only* on provided data):**

1.  **Strict Weighting:** Apply the 70/20/10 weighting rigorously. Findings from the PRIMARY timeframe are most important. Use SECONDARY and BASELINE primarily for context, corroboration, contradiction, or identifying shifts.

2.  **Analysis Steps:**
    *   **Identify Key PRIMARY Facts:** What are the most critical, potentially market-moving facts reported in the last 24-48 hours?
    *   **Contextualize with SECONDARY:** Does the 7-day data confirm, contradict, or add nuance to the PRIMARY facts? Are there developing trends?
    *   **Compare with BASELINE:** Does the recent news (PRIMARY/SECONDARY) align with or diverge from the 30-day context/sentiment?
    *   **Assess Sentiment (Data-Driven):** What is the dominant sentiment (positive, negative, neutral) evident *in the text* of the results for each period? Note significant shifts or conflicts.
    *   **Extract Actionable Facts:** Prioritize concrete details (figures, specific events, price targets mentioned).
    *   **Note Key Themes/Contradictions:** Identify recurring topics or conflicting reports within or across timeframes.

3.  **Output Synthesis (\`summary_analysis\`):**
    *   Produce a concise summary as an **array of strings (max 10 bullet points total)**.
    *   **Start with the most impactful findings from the PRIMARY (70%) data.** Then integrate key context/shifts identified from SECONDARY (20%) and BASELINE (10%) data.
    *   Each string must be a distinct, factual observation derived *directly* from the provided search results.
    *   Structure points logically (e.g., group by theme like Earnings, Competition, Sentiment).
    *   **Crucially: Do NOT add external knowledge, interpretations, predictions, or financial advice.** Stick strictly to synthesizing the provided text data according to the weights.

Generate the \`summary_analysis\` array based *only* on this methodology and the provided JSON data. Ensure conciseness and adherence to the bullet point count limit.
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
      model: largeModel,
      schema: z.object({
        signal: z.enum(["bullish", "bearish", "neutral"]),
        confidence: z
          .number()
          .min(0)
          .max(100)
          .int()
          .describe(
            "Confidence (0-100) based *only* on the clarity, consistency, and strength of evidence in the summary_analysis. High confidence requires strong, consistent evidence, especially weighted towards recent data."
          ),
        action: z.enum(["buy", "cover", "sell", "short", "hold"]),
        stocks: z
          .number()
          .min(0)
          .int()
          .describe(
            "Hypothetical number of shares (0-200 scale). 0 for hold. ~50 for low confidence action, ~100 for moderate, ~200 for high. Based purely on confidence derived from the analysis."
          ),
        reason: z
          .string()
          .describe(
            "Detailed and Descriptive step-by-step justification based *strictly* on summary_analysis. Must: 1) Explicitly reference/quote key bullish/bearish points from summary_analysis. 2) Explain how timeframe weighting (Recent > Weekly > Monthly implicit in summary) led to the conclusion. 3) Directly link specific summary points to the final signal, confidence score, and action."
          ),
      }),
      prompt: `
You are an AI financial signal generator. Your task is to generate a trading signal based *exclusively* on the provided \`summary_analysis\` (which implicitly reflects weighted timeframes: 70% Recent, 20% Weekly, 10% Monthly).

**Input Analysis Summary:**
\`\`\`
${summary_analysis.map(s => `- ${s}`).join("\n")}
\`\`\`

**Task:** Generate a trading signal object based *only* on the text above.

- **\`signal\` (enum: "bullish", "bearish", "neutral"):** Determine the overall directional outlook derived *strictly* from the summary points.
- **\`confidence\` (integer 0-100):** Assess confidence based *only* on the evidence in the summary.
    - High (71-100): Clear, consistent, strong evidence heavily supported by recent (implicitly primary) points.
    - Moderate (31-70): Mixed signals, or evidence is present but not overwhelming.
    - Low (0-30): Contradictory, weak, or predominantly neutral evidence.
- **\`action\` (enum: "buy", "cover", "sell", "short", "hold"):** Choose the logical action based on signal and confidence.
    - Bullish (Conf > 30): 'buy' / 'cover'
    - Bearish (Conf > 30): 'sell' / 'short'
    - Neutral or Low Confidence (<= 30): 'hold'
- **\`stocks\` (integer 0-200):** Suggest a *hypothetical* number of shares based *only* on confidence.
    - 0: If action is 'hold'.
    - ~50: Low actionable confidence (e.g., 31-50).
    - ~100: Moderate confidence (e.g., 51-75).
    - ~200: High confidence (e.g., 76-100).
    (Use rough guidelines, exact number isn't critical).
- **\`reason\` (string):** Provide a detailed justification adhering *strictly* to these steps:
    1.  **Quote Supporting Evidence:** Explicitly quote or reference the specific bullet point(s) from \`summary_analysis\` that support a bullish outlook. Do the same for bearish points. State if evidence is lacking for either.
    2.  **Explain Weighting Impact:** Briefly explain how the (implicit) emphasis on more recent information (predominantly captured in the summary) influenced the signal determination when weighing the bullish vs. bearish points.
    3.  **Link to Conclusion:** Clearly connect the identified evidence and weighting assessment to the final \`signal\`, the calculated \`confidence\` score, the chosen \`action\`, and the suggested \`stocks\` number. Justify *why* the evidence leads to this specific output.

**CRITICAL Constraints:**
- Base your *entire* output *SOLELY* on the provided \`summary_analysis\` text.
- Do NOT use any external data, prior knowledge, or make assumptions beyond what is written in the summary.
- Do NOT provide financial advice; simply generate the structured signal based *only* on the input.
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

export async function validateTicker(
  ticker: string
): Promise<{ success: boolean; ticker?: string; error?: string }> {
  try {
    const searchResult = await yahooFinance.search(ticker);

    if (searchResult && searchResult.quotes && searchResult.quotes.length > 0) {
      const exactMatch = searchResult.quotes.find(
        (quote): quote is { symbol: string } & typeof quote =>
          quote &&
          "symbol" in quote &&
          typeof quote.symbol === "string" &&
          quote.symbol === ticker
      );

      if (exactMatch && exactMatch.symbol) {
        return { success: true, ticker: exactMatch.symbol };
      } else {
        const suggestedSymbols = searchResult.quotes
          .filter(
            (quote): quote is { symbol: string } & typeof quote =>
              quote && "symbol" in quote && typeof quote.symbol === "string"
          )
          .map((q) => q.symbol)
          .slice(0, 3)
          .join(", ");

        const errorMessage = suggestedSymbols
          ? `Ticker symbol "${ticker}" not found. Did you mean one of these: ${suggestedSymbols}?`
          : `Ticker symbol "${ticker}" not found. No similar symbols were identified.`;

        return { success: false, error: errorMessage };
      }
    } else {
      return {
        success: false,
        error: `No results found for ticker symbol: ${ticker}`,
      };
    }
  } catch (error) {
    console.error(`Validation failed for ticker "${ticker}":`, error);
    if (
      error instanceof Error &&
      (error.message.includes("Not Found") ||
        error.message.includes("Failed to fetch"))
    ) {
      return {
        success: false,
        error: `Error searching for ticker symbol: ${ticker}`,
      };
    }
    return {
      success: false,
      error: "Failed to validate ticker due to an unexpected error.",
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

function filterResultsByDate(
  searchResponse: TavilySearchResponse | null,
  startDate: Date,
  endDate: Date
): TavilySearchResponse | null {
  if (!searchResponse || !searchResponse.results) {
    return searchResponse;
  }

  const filteredResults = searchResponse.results.filter((item) => {
    if (!item.published_date) {
      return true;
    }
    try {
      const itemDate = new Date(item.published_date);
      if (isNaN(itemDate.getTime())) return false;
      return itemDate >= startDate && itemDate <= endDate;
    } catch (e) {
      console.warn("Could not parse date:", item.published_date);
      return false;
    }
  });

  return {
    ...searchResponse,
    results: filteredResults,
  };
}
