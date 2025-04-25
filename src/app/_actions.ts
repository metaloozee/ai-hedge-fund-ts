'use server';

import { z } from 'zod';
import { google } from '@ai-sdk/google';
import { convertToCoreMessages, generateObject, Message } from 'ai';
import { tavily } from '@tavily/core';
import yahooFinance from 'yahoo-finance2';

const tvly = tavily({ apiKey: process.env.TAVILY_API_KEY });

const largeModel = google('gemini-2.5-pro-exp-03-25');

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
            : 'based on the latest available data';

        const timeConstraints = simulationDate
            ? ` Crucially, queries MUST be phrased to find information that would have been *knowable before* the end of ${simulationDate.toLocaleDateString()}. Do not ask about events *on* or *after* this date.`
            : '';

        const { object } = await generateObject({
            model: largeModel,
            schema: z.object({
                recent_queries: z
                    .array(z.string())
                    .max(5)
                    .describe(
                        'Queries for high-impact news (24-48 hours prior). Examples: earnings releases, major analyst changes, M&A.'
                    ),
                weekly_queries: z
                    .array(z.string())
                    .max(5)
                    .describe(
                        'Queries for developing stories (7 days prior). Examples: follow-up news, competitor actions, sector trends.'
                    ),
                monthly_queries: z
                    .array(z.string())
                    .max(5)
                    .describe(
                        'Queries for broader context (30 days prior). Examples: regulatory changes, product launches, sentiment shifts.'
                    ),
                earnings_call_queries: z
                    .array(z.string())
                    .max(3)
                    .describe(
                        'Queries specifically targeting recent earnings calls and transcripts for the company.'
                    ),
            }),
            prompt: `
You are an expert financial market AI assistant specializing in crafting precise search queries for financial news APIs (like Tavily).
Your goal is to generate highly relevant search queries for the stock ticker: ${ticker}, focusing on information available ${dateContext}.

Generate four distinct sets of search queries, optimized for fact-finding and covering different timeframes relative to ${dateContext}:

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

- **Earnings Call Queries - \`earnings_call_queries\`, max 3):**
  * Focus: Most recent earnings call transcripts, presentations, and analyst discussions for ${ticker}.
  * Target: Quarterly earnings transcripts, management guidance, Q&A sessions with analysts, forward-looking statements.
  * Keywords: Use specific earnings-related terms ("${ticker} latest earnings call transcript", "${ticker} quarterly earnings presentation", "${ticker} CEO comments earnings call").
  * Goal: Extract key insights from company management's own words and financial projections.

**Instructions:**
- Ensure all queries are specific to ${ticker}.
- Phrase queries precisely for a financial news search engine, seeking *confirmed facts* or *reported events* available ${dateContext}.
- Aim for queries likely to yield actionable, factual information (e.g., numbers, announcements, specific ratings). Avoid vague or purely sentiment-based queries (e.g., "Is ${ticker} a good buy?").
- ${timeConstraints}
`,
        });

        console.log('Step 1: Generated Queries for', ticker, object);

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
            error: e instanceof Error ? e.message : 'An error occurred',
        };
    }
}

export async function fetchData(
    ticker: string,
    recent_queries: string[],
    weekly_queries: string[],
    monthly_queries: string[],
    earnings_call_queries: string[] = [],
    simulationDate?: Date
): Promise<{
    success: boolean;
    data?: {
        ticker: string;
        stockData: any;
        recentResults: NewsSearchResult[];
        weeklyResults: SocialSearchResult[];
        monthlyResults: FinanceSearchResult[];
        earningsCallResults: SearchResult[];
    };
    error?: string;
}> {
    try {
        const recentResults: NewsSearchResult[] = [];
        const weeklyResults: SocialSearchResult[] = [];
        const monthlyResults: FinanceSearchResult[] = [];
        const earningsCallResults: SearchResult[] = [];

        const searchOptionsBase = simulationDate ? { search_depth: 'advanced' as const } : {};

        const recentEndDate = simulationDate ? simulationDate : new Date();
        const recentStartDate = new Date(recentEndDate);
        recentStartDate.setDate(recentEndDate.getDate() - 2);

        await Promise.all(
            recent_queries.map(async (query) => {
                try {
                    const options = {
                        ...searchOptionsBase,
                        topic: 'news' as const,
                        ...(simulationDate && {
                            max_results: 7,
                        }),
                    };
                    const res = await tvly.search(query, options);
                    const dedupedResults = deduplicateSearchResults(res) as TavilySearchResponse;
                    recentResults.push({
                        query,
                        result: filterResultsByDate(dedupedResults, recentStartDate, recentEndDate),
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
                        topic: 'general' as const,
                        ...(simulationDate && {
                            max_results: 7,
                        }),
                    };
                    const res = await tvly.search(query, options);
                    const dedupedResults = deduplicateSearchResults(res) as TavilySearchResponse;
                    weeklyResults.push({
                        query,
                        result: filterResultsByDate(dedupedResults, weeklyStartDate, weeklyEndDate),
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
                        topic: 'general' as const,
                        ...(simulationDate && {
                            max_results: 7,
                        }),
                    };
                    const res = await tvly.search(query, options);
                    const dedupedResults = deduplicateSearchResults(res) as TavilySearchResponse;
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

        const earningsEndDate = simulationDate ? simulationDate : new Date();
        const earningsStartDate = new Date(earningsEndDate);
        earningsStartDate.setDate(earningsEndDate.getDate() - 90);

        await Promise.all(
            earnings_call_queries.map(async (query) => {
                try {
                    const options = {
                        ...searchOptionsBase,
                        topic: 'finance' as const,
                        ...(simulationDate && {
                            max_results: 7,
                        }),
                    };
                    const res = await tvly.search(query, options);
                    const dedupedResults = deduplicateSearchResults(res) as TavilySearchResponse;
                    earningsCallResults.push({
                        query,
                        result: filterResultsByDate(
                            dedupedResults,
                            earningsStartDate,
                            earningsEndDate
                        ),
                        success: true,
                    });
                } catch (error) {
                    earningsCallResults.push({
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
                period1: simStartDate.toISOString().split('T')[0],
                period2: simEndDate.toISOString().split('T')[0],
            });
        } else {
            stockDataResult = await yahooFinance.chart(ticker, {
                period1: '2024-01-01',
                period2: new Date().toISOString().split('T')[0],
            });
        }

        if (!stockDataResult) {
            throw new Error(
                `Stock data not found for ${ticker}${
                    simulationDate ? ` around ${simulationDate.toLocaleDateString()}` : ''
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
                earningsCallResults,
            },
        };
    } catch (e) {
        console.error(e);
        return {
            success: false,
            error: e instanceof Error ? e.message : 'An error occurred',
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
                    'symbol' in quote &&
                    typeof quote.symbol === 'string' &&
                    quote.symbol === ticker
            );

            if (exactMatch && exactMatch.symbol) {
                return { success: true, ticker: exactMatch.symbol };
            } else {
                const suggestedSymbols = searchResult.quotes
                    .filter(
                        (quote): quote is { symbol: string } & typeof quote =>
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
            return {
                success: false,
                error: `No results found for ticker symbol: ${ticker}`,
            };
        }
    } catch (error) {
        console.error(`Validation failed for ticker "${ticker}":`, error);
        if (
            error instanceof Error &&
            (error.message.includes('Not Found') || error.message.includes('Failed to fetch'))
        ) {
            return {
                success: false,
                error: `Error searching for ticker symbol: ${ticker}`,
            };
        }
        return {
            success: false,
            error: 'Failed to validate ticker due to an unexpected error.',
        };
    }
}

function normalizeUrl(url: string): string {
    try {
        return url
            .trim()
            .toLowerCase()
            .replace(/\/$/, '')
            .replace(/^https?:\/\//, '')
            .replace(/^www\./, '');
    } catch {
        return url;
    }
}

function deduplicateSearchResults(searchResults: any): TavilySearchResponse {
    if (!searchResults || !searchResults.results || !Array.isArray(searchResults.results)) {
        return searchResults as TavilySearchResponse;
    }

    const seenUrls = new Set<string>();
    const dedupedResults = { ...searchResults } as TavilySearchResponse;

    if (dedupedResults.results) {
        dedupedResults.results = dedupedResults.results.filter((result: SearchResultItem) => {
            if (!result || !result.url) return true;

            const url = normalizeUrl(result.url);
            if (seenUrls.has(url)) {
                return false;
            }

            seenUrls.add(url);
            return true;
        });
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
            console.warn('Could not parse date:', item.published_date);
            return false;
        }
    });

    return {
        ...searchResponse,
        results: filteredResults,
    };
}

export async function analyzeQueryResults(
    recentResults: NewsSearchResult[],
    weeklyResults: SocialSearchResult[],
    monthlyResults: FinanceSearchResult[],
    earningsCallResults: SearchResult[]
) {
    try {
        const { object } = await generateObject({
            model: largeModel,
            schema: z.object({
                recent_analysis: z.array(
                    z.object({
                        query: z.string(),
                        relevant: z
                            .boolean()
                            .describe(
                                'Whether this query returned relevant information worth keeping'
                            ),
                        key_points: z
                            .array(z.string())
                            .describe('Key insights extracted from this query, if relevant'),
                    })
                ),
                weekly_analysis: z.array(
                    z.object({
                        query: z.string(),
                        relevant: z
                            .boolean()
                            .describe(
                                'Whether this query returned relevant information worth keeping'
                            ),
                        key_points: z
                            .array(z.string())
                            .describe('Key insights extracted from this query, if relevant'),
                    })
                ),
                monthly_analysis: z.array(
                    z.object({
                        query: z.string(),
                        relevant: z
                            .boolean()
                            .describe(
                                'Whether this query returned relevant information worth keeping'
                            ),
                        key_points: z
                            .array(z.string())
                            .describe('Key insights extracted from this query, if relevant'),
                    })
                ),
                earnings_call_analysis: z.array(
                    z.object({
                        query: z.string(),
                        relevant: z
                            .boolean()
                            .describe(
                                'Whether this query returned relevant information worth keeping'
                            ),
                        key_points: z
                            .array(z.string())
                            .describe('Key insights extracted from this query, if relevant'),
                    })
                ),
            }),
            prompt: `
You are a financial data analysis AI. Your task is to evaluate search results about a specific stock and determine which queries returned relevant, useful information.

**Input Search Results Data:**

*   **RECENT (Last 24-48 hours):**
    \`\`\`json
    ${JSON.stringify(recentResults)}
    \`\`\`
*   **WEEKLY (Last 7 days):** 
    \`\`\`json
    ${JSON.stringify(weeklyResults)}
    \`\`\`
*   **MONTHLY (Last 30 days):**
    \`\`\`json
    ${JSON.stringify(monthlyResults)}
    \`\`\`
*   **EARNINGS CALLS:**
    \`\`\`json
    ${JSON.stringify(earningsCallResults)}
    \`\`\`

**Analysis Task:**

For each query in each timeframe, determine:
1. Whether the query returned relevant information worth keeping (true/false)
2. If relevant, extract 1-3 key points or insights from the results

Consider information relevant if it:
- Contains specific facts or figures about the company
- Discusses meaningful events or announcements
- Provides analyst opinions with substantive reasoning
- Includes management commentary or guidance
- Reveals market sentiment with concrete examples

Discard information that is:
- Generic or vague with no specific facts
- Completely unrelated to the company
- Purely promotional without substance
- Outdated or superseded by more recent information
- Lacking any actionable insights

For each query, provide a boolean relevance determination and, if relevant, list the key points extracted from the results.
`,
        });

        if (!object) {
            throw new Error('Failed to analyze query results');
        }

        return {
            success: true,
            data: object,
        };
    } catch (e) {
        console.error(e);
        return {
            success: false,
            error: e instanceof Error ? e.message : 'An error occurred during query analysis',
        };
    }
}

export async function generateResearchReport(ticker: string, stockData: any, queryAnalysis: any) {
    try {
        const { object } = await generateObject({
            model: largeModel,
            schema: z.object({
                executive_summary: z
                    .string()
                    .describe('A concise 2-3 sentence overview of the key findings'),
                stock_performance: z.object({
                    recent_trend: z.string(),
                    key_price_points: z.array(
                        z.object({
                            description: z.string(),
                            value: z.number(),
                        })
                    ),
                    volatility_assessment: z.string(),
                }),
                fundamental_analysis: z.object({
                    earnings: z.string(),
                    revenue: z.string(),
                    growth_outlook: z.string(),
                    management_commentary: z.string().optional(),
                }),
                market_sentiment: z.object({
                    analyst_ratings: z.string(),
                    institutional_activity: z.string().optional(),
                    retail_sentiment: z.string().optional(),
                    news_sentiment: z.string(),
                }),
                risk_assessment: z.array(
                    z.object({
                        risk_factor: z.string(),
                        impact: z.enum(['Low', 'Medium', 'High']),
                        description: z.string(),
                    })
                ),
                competitive_position: z.string(),
                conclusion: z.string().describe('A balanced summary of the overall outlook'),
            }),
            prompt: `
You are a financial research analyst tasked with creating a comprehensive research report on ${ticker} based on the following data:

**Stock Data:**
\`\`\`json
${JSON.stringify(stockData)}
\`\`\`

**Query Analysis Results:**
\`\`\`json
${JSON.stringify(queryAnalysis)}
\`\`\`

Create a structured research report that includes:

1. **Executive Summary**: A concise overview of your key findings (2-3 sentences)

2. **Stock Performance Analysis**:
   - Recent price trend description
   - Key price points (support/resistance levels, recent highs/lows)
   - Assessment of recent volatility

3. **Fundamental Analysis**:
   - Earnings performance insights
   - Revenue trends
   - Growth outlook
   - Management commentary (if available from earnings calls)

4. **Market Sentiment**:
   - Analyst ratings and price targets
   - Institutional buying/selling (if available)
   - Retail investor sentiment (if available)
   - Overall news sentiment

5. **Risk Assessment**:
   - 2-4 key risk factors with impact rating (Low/Medium/High) and brief description

6. **Competitive Position**:
   - Brief analysis of the company's position relative to competitors

7. **Conclusion**:
   - Balanced summary of the overall outlook

Important guidelines:
- Based your analysis STRICTLY on the provided data
- Include specific figures and facts where available
- Maintain objectivity and balance
- Highlight both positive and negative factors
- DO NOT include specific trading recommendations or price targets unless they were explicitly mentioned in the data
`,
        });

        if (!object) {
            throw new Error('Failed to generate research report');
        }

        return {
            success: true,
            data: object,
        };
    } catch (e) {
        console.error(e);
        return {
            success: false,
            error: e instanceof Error ? e.message : 'An error occurred during report generation',
        };
    }
}

export async function generateImprovedSignals(ticker: string, researchReport: any) {
    try {
        const { object } = await generateObject({
            model: largeModel,
            schema: z.object({
                signal: z.enum(['bullish', 'bearish', 'neutral']),
                confidence: z
                    .number()
                    .min(0)
                    .max(100)
                    .int()
                    .describe(
                        'Confidence (0-100) based on the clarity, consistency, and strength of evidence in the research report.'
                    ),
                action: z.enum(['buy', 'cover', 'sell', 'short', 'hold']),
                stocks: z
                    .number()
                    .min(0)
                    .int()
                    .describe(
                        'Hypothetical number of shares (0-200 scale). 0 for hold. ~50 for low confidence action, ~100 for moderate, ~200 for high.'
                    ),
                reason: z
                    .string()
                    .describe(
                        'Detailed justification based on the research report that explains the reasoning behind the signal, confidence, and recommended action.'
                    ),
                price_targets: z
                    .object({
                        conservative: z.number().optional(),
                        base_case: z.number().optional(),
                        optimistic: z.number().optional(),
                    })
                    .describe(
                        'Potential price targets if mentioned in research or calculable from data'
                    ),
                time_horizon: z
                    .enum(['short_term', 'medium_term', 'long_term'])
                    .describe('The recommended time horizon for this trading signal'),
            }),
            prompt: `
You are an AI trading signal generator. Your task is to generate a comprehensive trading signal based on the provided research report for ${ticker}.

**Research Report:**
\`\`\`json
${JSON.stringify(researchReport)}
\`\`\`

**Task:** Generate a trading signal object based on the research report.

- **\`signal\` (enum: "bullish", "bearish", "neutral"):** Determine the overall directional outlook.
- **\`confidence\` (integer 0-100):** Assess confidence based on the evidence in the report.
    - High (71-100): Clear, consistent, strong evidence
    - Moderate (31-70): Mixed signals, or evidence is present but not overwhelming
    - Low (0-30): Contradictory, weak, or predominantly neutral evidence
- **\`action\` (enum: "buy", "cover", "sell", "short", "hold"):** Choose the logical action based on signal and confidence.
    - Bullish (Conf > 30): 'buy' / 'cover'
    - Bearish (Conf > 30): 'sell' / 'short'
    - Neutral or Low Confidence (<= 30): 'hold'
- **\`stocks\` (integer 0-200):** Suggest a *hypothetical* number of shares based only on confidence.
    - 0: If action is 'hold'
    - ~50: Low actionable confidence (e.g., 31-50)
    - ~100: Moderate confidence (e.g., 51-75)
    - ~200: High confidence (e.g., 76-100)
- **\`reason\` (string):** Provide a detailed justification that:
    1. Summarizes the key factors leading to your conclusion
    2. Addresses both positive and negative aspects from the report
    3. Explains your confidence level and why you chose the specific action
    4. Acknowledges key risks to the position
- **\`price_targets\`:** If the report contains relevant information, provide conservative, base case, and optimistic price targets.
- **\`time_horizon\`:** Recommend a time horizon (short_term: days/weeks, medium_term: months, long_term: 6+ months) based on the nature of the catalysts and trends identified.

**CRITICAL Constraints:**
- Base your *entire* output *SOLELY* on the provided research report.
- Do NOT use any external data or prior knowledge beyond what is in the report.
- Do NOT provide financial advice; simply generate the structured signal based on the input.
`,
        });

        if (!object) {
            throw new Error('Failed to generate trading signal');
        }

        return {
            success: true,
            data: object,
        };
    } catch (error) {
        console.error(error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'An error occurred',
        };
    }
}
