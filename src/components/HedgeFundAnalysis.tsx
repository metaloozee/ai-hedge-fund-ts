'use client';

import { useState, FormEvent } from 'react';
import {
    fetchData,
    generateQueries,
    generateImprovedSignals,
    analyzeQueryResults,
    generateResearchReport,
    validateTicker,
} from '@/app/_actions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { TextShimmer } from '@/components/ui/text-shimmer';
import MarkdownRenderer from './MarkdownRenderer';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface StockSignal {
    signal: 'bullish' | 'bearish' | 'neutral';
    confidence: number;
    action: 'buy' | 'cover' | 'sell' | 'short' | 'hold';
    stocks: number;
    reason: string;
    price_targets?: {
        conservative?: number;
        base_case?: number;
        optimistic?: number;
    };
    time_horizon: 'short_term' | 'medium_term' | 'long_term';
}

interface QueryResult {
    success: boolean;
    data?: {
        ticker: string;
        recent_queries: string[];
        weekly_queries: string[];
        monthly_queries: string[];
        earnings_call_queries: string[];
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
        earningsCallResults: any[];
    };
    error?: string;
}

interface QueryAnalysisResult {
    success: boolean;
    data?: {
        recent_analysis: Array<{
            query: string;
            relevant: boolean;
            key_points: string[];
        }>;
        weekly_analysis: Array<{
            query: string;
            relevant: boolean;
            key_points: string[];
        }>;
        monthly_analysis: Array<{
            query: string;
            relevant: boolean;
            key_points: string[];
        }>;
        earnings_call_analysis: Array<{
            query: string;
            relevant: boolean;
            key_points: string[];
        }>;
    };
    error?: string;
}

interface ResearchReport {
    executive_summary: string;
    stock_performance: {
        recent_trend: string;
        key_price_points: Array<{
            description: string;
            value: number;
        }>;
        volatility_assessment: string;
    };
    fundamental_analysis: {
        earnings: string;
        revenue: string;
        growth_outlook: string;
        management_commentary?: string;
    };
    market_sentiment: {
        analyst_ratings: string;
        institutional_activity?: string;
        retail_sentiment?: string;
        news_sentiment: string;
    };
    risk_assessment: Array<{
        risk_factor: string;
        impact: 'Low' | 'Medium' | 'High';
        description: string;
    }>;
    competitive_position: string;
    conclusion: string;
}

interface ReportResult {
    success: boolean;
    data?: ResearchReport;
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
    const [signal, setSignal] = useState<StockSignal | null>(null);
    const [report, setReport] = useState<ResearchReport | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [currentStep, setCurrentStep] = useState<string>('idle');
    const [tickerInput, setTickerInput] = useState<string>('');
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
        setSignal(null);
        setReport(null);
        setStockData(null);
        setCurrentStep(`Validating ticker: ${tickerToValidate}...`);

        validateTicker(tickerToValidate)
            .then((validateResult: ValidateResult) => {
                if (!validateResult.success || !validateResult.ticker) {
                    throw new Error(validateResult.error || 'Invalid ticker symbol');
                }
                const validatedTickerString = validateResult.ticker;

                setCurrentStep(`Generating queries for ${validatedTickerString}...`);
                return generateQueries(validatedTickerString).then((queriesResult: QueryResult) => {
                    if (!queriesResult.success || !queriesResult.data) {
                        throw new Error(queriesResult.error || 'Failed to generate queries');
                    }
                    return { validatedTicker: validatedTickerString, queriesResult };
                });
            })
            .then(
                ({
                    validatedTicker,
                    queriesResult,
                }: {
                    validatedTicker: string;
                    queriesResult: QueryResult;
                }) => {
                    setCurrentStep(`Fetching stock and market data for ${validatedTicker}...`);
                    const {
                        recent_queries,
                        weekly_queries,
                        monthly_queries,
                        earnings_call_queries = [],
                    } = queriesResult.data!;

                    return fetchData(
                        validatedTicker,
                        recent_queries,
                        weekly_queries,
                        monthly_queries,
                        earnings_call_queries
                    ).then((fetchResult) => ({ validatedTicker, fetchResult }));
                }
            )
            .then(
                ({
                    validatedTicker,
                    fetchResult,
                }: {
                    validatedTicker: string;
                    fetchResult: FetchResult;
                }) => {
                    if (!fetchResult.success || !fetchResult.data) {
                        throw new Error(fetchResult.error || 'Failed to fetch data');
                    }

                    const {
                        stockData,
                        recentResults,
                        weeklyResults,
                        monthlyResults,
                        earningsCallResults,
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

                    setCurrentStep('Analyzing query results...');
                    return analyzeQueryResults(
                        recentResults,
                        weeklyResults,
                        monthlyResults,
                        earningsCallResults
                    ).then((analysisResult: QueryAnalysisResult) => {
                        if (!analysisResult.success || !analysisResult.data) {
                            throw new Error(
                                analysisResult.error || 'Failed to analyze query results'
                            );
                        }

                        if (!fetchResult.data) {
                            throw new Error('Fetch result data is undefined');
                        }

                        return {
                            validatedTicker,
                            stockData: fetchResult.data.stockData,
                            queryAnalysis: analysisResult.data,
                        };
                    });
                }
            )
            .then(({ validatedTicker, stockData, queryAnalysis }) => {
                setCurrentStep('Generating research report...');
                return generateResearchReport(validatedTicker, stockData, queryAnalysis).then(
                    (reportResult: ReportResult) => {
                        if (!reportResult.success || !reportResult.data) {
                            throw new Error(
                                reportResult.error || 'Failed to generate research report'
                            );
                        }

                        setReport(reportResult.data);
                        return { validatedTicker, report: reportResult.data };
                    }
                );
            })
            .then(({ validatedTicker, report }) => {
                setCurrentStep('Generating trading signals...');
                return generateImprovedSignals(validatedTicker, report).then(
                    (signalResult: SignalResult) => {
                        if (!signalResult.success || !signalResult.data) {
                            throw new Error(signalResult.error || 'Failed to generate signals');
                        }

                        setSignal(signalResult.data);
                        setCurrentStep('completed');
                    }
                );
            })
            .catch((err: Error) => {
                console.error(err);
                setError(err.message || 'An error occurred during analysis');
                setCurrentStep('error');
            })
            .finally(() => {
                setIsLoading(false);
            });
    };

    return (
        <div className="max-w-4xl mx-auto">
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
                            {isLoading ? 'Analyzing...' : 'Analyze'}
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
                                            {stockData.priceChange >= 0 ? '+' : ''}
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
                                                ? 'text-green-500'
                                                : 'text-red-500'
                                        }`}
                                    >
                                        ${stockData.price.toFixed(2)}
                                    </span>
                                </div>

                                <ChartContainer
                                    config={{
                                        price: {
                                            label: 'Price',
                                            color:
                                                stockData.priceChange >= 0
                                                    ? 'hsl(142, 76%, 36%)'
                                                    : 'hsl(0, 84%, 60%)',
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
                                                            ? 'hsl(142, 76%, 36%)'
                                                            : 'hsl(0, 84%, 60%)'
                                                    }
                                                    stopOpacity={0.8}
                                                />
                                                <stop
                                                    offset="95%"
                                                    stopColor={
                                                        stockData.priceChange >= 0
                                                            ? 'hsl(142, 76%, 36%)'
                                                            : 'hsl(0, 84%, 60%)'
                                                    }
                                                    stopOpacity={0}
                                                />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.3} />
                                        <ChartTooltip
                                            content={<ChartTooltipContent />}
                                            cursor={{
                                                stroke: 'var(--border)',
                                                strokeWidth: 1,
                                                strokeDasharray: '4 4',
                                            }}
                                        />
                                        <Area
                                            type="monotone"
                                            dataKey="price"
                                            stroke={
                                                stockData.priceChange >= 0
                                                    ? 'hsl(142, 76%, 36%)'
                                                    : 'hsl(0, 84%, 60%)'
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

                    {report && signal && (
                        <div className="mt-6 space-y-4">
                            <Tabs defaultValue="signal" className="w-full">
                                <TabsList className="grid grid-cols-2">
                                    <TabsTrigger value="signal">Trading Signal</TabsTrigger>
                                    <TabsTrigger value="report">Research Report</TabsTrigger>
                                </TabsList>

                                <TabsContent
                                    value="signal"
                                    className="p-4 rounded-md bg-card border mt-2"
                                >
                                    <h3 className="font-semibold text-lg mb-2 flex items-center gap-2">
                                        <span
                                            className={`inline-block w-3 h-3 rounded-full ${
                                                signal.signal === 'bullish'
                                                    ? 'bg-green-500'
                                                    : signal.signal === 'bearish'
                                                      ? 'bg-red-500'
                                                      : 'bg-yellow-500'
                                            }`}
                                        />
                                        {signal.signal.charAt(0).toUpperCase() +
                                            signal.signal.slice(1)}{' '}
                                        Signal
                                        <span className="font-normal text-sm text-muted-foreground ml-auto">
                                            {signal.confidence}% confidence
                                        </span>
                                    </h3>
                                    <p className="text-base font-medium mb-1">
                                        Recommended Action:{' '}
                                        <span className="capitalize">{signal.action}</span>{' '}
                                        {signal.stocks} stocks
                                    </p>

                                    {signal.price_targets && (
                                        <div className="mt-2 mb-3">
                                            <h4 className="text-sm font-medium">Price Targets:</h4>
                                            <div className="flex gap-4 text-sm mt-1">
                                                {signal.price_targets.conservative && (
                                                    <div>
                                                        <span className="text-muted-foreground">
                                                            Conservative:
                                                        </span>{' '}
                                                        <span className="font-medium">
                                                            $
                                                            {signal.price_targets.conservative.toFixed(
                                                                2
                                                            )}
                                                        </span>
                                                    </div>
                                                )}
                                                {signal.price_targets.base_case && (
                                                    <div>
                                                        <span className="text-muted-foreground">
                                                            Base Case:
                                                        </span>{' '}
                                                        <span className="font-medium">
                                                            $
                                                            {signal.price_targets.base_case.toFixed(
                                                                2
                                                            )}
                                                        </span>
                                                    </div>
                                                )}
                                                {signal.price_targets.optimistic && (
                                                    <div>
                                                        <span className="text-muted-foreground">
                                                            Optimistic:
                                                        </span>{' '}
                                                        <span className="font-medium">
                                                            $
                                                            {signal.price_targets.optimistic.toFixed(
                                                                2
                                                            )}
                                                        </span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}

                                    <div className="mb-2">
                                        <span className="text-sm text-muted-foreground">
                                            Time Horizon:
                                            <span className="capitalize ml-1">
                                                {signal.time_horizon.replace('_', ' ')}
                                            </span>
                                        </span>
                                    </div>

                                    <MarkdownRenderer content={signal.reason} />
                                </TabsContent>

                                <TabsContent
                                    value="report"
                                    className="p-4 rounded-md bg-card border mt-2"
                                >
                                    <div className="space-y-4">
                                        <div>
                                            <h3 className="font-semibold text-lg">
                                                Executive Summary
                                            </h3>
                                            <p>{report.executive_summary}</p>
                                        </div>

                                        <div>
                                            <h3 className="font-semibold text-lg">
                                                Stock Performance
                                            </h3>
                                            <p className="mb-2">
                                                {report.stock_performance.recent_trend}
                                            </p>

                                            <h4 className="font-medium text-sm mb-1">
                                                Key Price Points
                                            </h4>
                                            <ul className="list-disc list-inside text-sm space-y-1 ml-2">
                                                {report.stock_performance.key_price_points.map(
                                                    (point, idx) => (
                                                        <li key={idx}>
                                                            {point.description}: $
                                                            {point.value.toFixed(2)}
                                                        </li>
                                                    )
                                                )}
                                            </ul>

                                            <p className="mt-2 text-sm">
                                                <span className="font-medium">Volatility: </span>
                                                {report.stock_performance.volatility_assessment}
                                            </p>
                                        </div>

                                        <div>
                                            <h3 className="font-semibold text-lg">
                                                Fundamental Analysis
                                            </h3>
                                            <p className="mb-1">
                                                <span className="font-medium">Earnings: </span>
                                                {report.fundamental_analysis.earnings}
                                            </p>
                                            <p className="mb-1">
                                                <span className="font-medium">Revenue: </span>
                                                {report.fundamental_analysis.revenue}
                                            </p>
                                            <p className="mb-1">
                                                <span className="font-medium">
                                                    Growth Outlook:{' '}
                                                </span>
                                                {report.fundamental_analysis.growth_outlook}
                                            </p>
                                            {report.fundamental_analysis.management_commentary && (
                                                <p>
                                                    <span className="font-medium">
                                                        Management Commentary:{' '}
                                                    </span>
                                                    {
                                                        report.fundamental_analysis
                                                            .management_commentary
                                                    }
                                                </p>
                                            )}
                                        </div>

                                        <div>
                                            <h3 className="font-semibold text-lg">
                                                Market Sentiment
                                            </h3>
                                            <p className="mb-1">
                                                <span className="font-medium">
                                                    Analyst Ratings:{' '}
                                                </span>
                                                {report.market_sentiment.analyst_ratings}
                                            </p>
                                            {report.market_sentiment.institutional_activity && (
                                                <p className="mb-1">
                                                    <span className="font-medium">
                                                        Institutional Activity:{' '}
                                                    </span>
                                                    {report.market_sentiment.institutional_activity}
                                                </p>
                                            )}
                                            {report.market_sentiment.retail_sentiment && (
                                                <p className="mb-1">
                                                    <span className="font-medium">
                                                        Retail Sentiment:{' '}
                                                    </span>
                                                    {report.market_sentiment.retail_sentiment}
                                                </p>
                                            )}
                                            <p>
                                                <span className="font-medium">
                                                    News Sentiment:{' '}
                                                </span>
                                                {report.market_sentiment.news_sentiment}
                                            </p>
                                        </div>

                                        <div>
                                            <h3 className="font-semibold text-lg">
                                                Risk Assessment
                                            </h3>
                                            <div className="space-y-2 mt-2">
                                                {report.risk_assessment.map((risk, idx) => (
                                                    <div key={idx} className="p-2 border rounded">
                                                        <div className="flex justify-between items-center">
                                                            <h4 className="font-medium">
                                                                {risk.risk_factor}
                                                            </h4>
                                                            <span
                                                                className={`text-xs px-2 py-1 rounded ${
                                                                    risk.impact === 'High'
                                                                        ? 'bg-red-100 text-red-800'
                                                                        : risk.impact === 'Medium'
                                                                          ? 'bg-amber-100 text-amber-800'
                                                                          : 'bg-blue-100 text-blue-800'
                                                                }`}
                                                            >
                                                                {risk.impact} Impact
                                                            </span>
                                                        </div>
                                                        <p className="text-sm mt-1">
                                                            {risk.description}
                                                        </p>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>

                                        <div>
                                            <h3 className="font-semibold text-lg">
                                                Competitive Position
                                            </h3>
                                            <p>{report.competitive_position}</p>
                                        </div>

                                        <div>
                                            <h3 className="font-semibold text-lg">Conclusion</h3>
                                            <p>{report.conclusion}</p>
                                        </div>
                                    </div>
                                </TabsContent>
                            </Tabs>
                        </div>
                    )}
                </CardContent>
                <CardFooter className="text-xs text-muted-foreground">
                    This analysis is for educational purposes only and should not be considered
                    financial advice.
                </CardFooter>
            </Card>
        </div>
    );
}
