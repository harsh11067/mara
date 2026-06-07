export type MacroEventState = 'upcoming' | 'watching' | 'fired';
export type ImpactLevel = 'high' | 'medium' | 'low';
export type TradeSide = 'LONG' | 'SHORT' | 'ROTATION';
export type TradeStatus = 'OPEN' | 'CLOSED' | 'PENDING';
export type DirectionType = 'STRONG_BULL' | 'BULL' | 'NEUTRAL' | 'BEAR' | 'STRONG_BEAR';

export interface MacroEvent {
  id: string;
  name: string;
  dateStr: string;
  timestamp: number;
  state: MacroEventState;
  consensus: string;
  actual?: string;
  previous: string;
  impact: ImpactLevel;
  unit: string;
}

export interface AiReasoning {
  id: string;
  eventName: string;
  timestamp: number;
  surpriseScore: number; // e.g., +1.33 (in standard deviations)
  direction: DirectionType;
  confidence: number; // 0-100
  actual: string;
  forecast: string;
  reasoning: string;
  sourceNews: string[];
}

export interface Trade {
  id: string;
  timeStr: string;
  timestamp: number;
  event: string;
  instrument: string;
  side: TradeSide;
  sizeUsd: number;
  quantity: number;
  priceEntry: number;
  priceExit?: number;
  leverage: number;
  stopLoss: number;
  takeProfit: number;
  pnl: number;
  pnlPercent: number;
  status: TradeStatus;
}

export interface SsiHolding {
  id: string;
  name: string;
  ticker: string;
  allocationPercent: number;
  currentPrice: number;
  balance: number;
  valueUsd: number;
  dailyChange: number;
}

export interface RotationLog {
  id: string;
  timeStr: string;
  fromTicker: string;
  toTicker: string;
  percentage: number;
  reason: string;
}

// Initial mockup data corresponding to Day 6 of MARA build plan
export const INITIAL_EVENTS: MacroEvent[] = [
  {
    id: "evt-nfp",
    name: "Nonfarm Payrolls (May)",
    dateStr: "2026-05-29 12:30 UTC",
    timestamp: Date.now() + 14400000, // 4 hours from now
    state: "watching",
    consensus: "185K",
    previous: "175K",
    impact: "high",
    unit: "K"
  },
  {
    id: "evt-cpi-curr",
    name: "U.S. Core CPI MoM",
    dateStr: "2026-05-28 12:30 UTC",
    timestamp: Date.now() - 3600000, // 1 hour ago
    state: "fired",
    consensus: "0.3%",
    actual: "0.4%",
    previous: "0.3%",
    impact: "high",
    unit: "%"
  },
  {
    id: "evt-fomc",
    name: "FOMC Rate Decision",
    dateStr: "2026-05-20 18:00 UTC",
    timestamp: Date.now() - 8 * 86400000, // 8 days ago
    state: "fired",
    consensus: "5.50%",
    actual: "5.50%",
    previous: "5.50%",
    impact: "high",
    unit: "%"
  },
  {
    id: "evt-retail-sales",
    name: "U.S. Retail Sales MoM",
    dateStr: "2026-05-30 12:30 UTC",
    timestamp: Date.now() + 100000000,
    state: "upcoming",
    consensus: "0.4%",
    previous: "0.2%",
    impact: "medium",
    unit: "%"
  },
  {
    id: "evt-gdp",
    name: "U.S. Q1 GDP (Pre-Estimate)",
    dateStr: "2026-06-02 12:30 UTC",
    timestamp: Date.now() + 300000000,
    state: "upcoming",
    consensus: "2.1%",
    previous: "1.9%",
    impact: "high",
    unit: "%"
  }
];

export const INITIAL_REASONINGS: AiReasoning[] = [
  {
    id: "reason-cpi-curr",
    eventName: "U.S. Core CPI MoM",
    timestamp: Date.now() - 3600000,
    surpriseScore: 1.45,
    direction: "STRONG_BEAR",
    confidence: 86,
    actual: "0.4%",
    forecast: "0.3%",
    reasoning: "U.S. Core CPI printed at 0.4% MoM, exceeding consensus of 0.3%. This sticky inflation print indicates a resilient price floor in services, reducing expectations of an upcoming Fed rate cut. Expecting standard yields to rise and risk assets to witness deleveraging. Portfolio recommendation: Initiate maximum directional short of BTC-USD perpetuals to hedge on-chain collateral, and execute emergency rotation of 15% SSI assets from MAG7.ssi (high-beta tech) into USSI (US Dollar Index proxy) to cushion drawdowns.",
    sourceNews: [
      "BLOOMBERG: US Core CPI Rises 0.4% MoM, Higher Than Forecasters Estimated",
      "REUTERS: Sticky US Inflation Diminishes Chances of Summer Rate Cut",
      "COINTELEGRAPH: Liquidation Event Triggers $120M in Leveraged Crypto Longs Post-CPI"
    ]
  },
  {
    id: "reason-fomc",
    eventName: "FOMC Rate Decision",
    timestamp: Date.now() - 8 * 86400000,
    surpriseScore: 0.00,
    direction: "NEUTRAL",
    confidence: 94,
    actual: "5.50%",
    forecast: "5.50%",
    reasoning: "Federal Reserve maintained the target range for the federal funds rate at 5.25%-5.50% in a unanimous decision, exactly in line with forecasts. Guidance changed marginally to echo 'lack of further progress' towards the 2% inflation mandate. Quantitative tightening pace was confirmed to taper as announced. Directional trigger is deactivated because this is a non-surprise. System maintains structural neutral, running market-making and funding rate farming strategies in spot markets.",
    sourceNews: [
      "FED PR: FOMC Statement Maintains Key Policy Rate Unchanged",
      "POWELL PRESSER: We need greater confidence that inflation is moving sustainably to 2%"
    ]
  }
];

export const INITIAL_TRADES: Trade[] = [
  {
    id: "trd-004",
    timeStr: "1 hour ago",
    timestamp: Date.now() - 3600000,
    event: "U.S. Core CPI MoM",
    instrument: "BTC-USD.PERP (SoDEX)",
    side: "SHORT",
    sizeUsd: 18500,
    quantity: 0.27,
    priceEntry: 68518.5,
    priceExit: undefined,
    leverage: 3,
    stopLoss: 69546.0,
    takeProfit: 66463.0,
    pnl: 341.52,
    pnlPercent: 1.85,
    status: "OPEN"
  },
  {
    id: "trd-003",
    timeStr: "1 hour ago",
    timestamp: Date.now() - 3600000,
    event: "U.S. Core CPI MoM",
    instrument: "MAG7.SSI / USSI Spot (SoDEX)",
    side: "ROTATION",
    sizeUsd: 14200,
    quantity: 1,
    priceEntry: 1.00,
    priceExit: undefined,
    leverage: 1,
    stopLoss: 0,
    takeProfit: 0,
    pnl: 0,
    pnlPercent: 0,
    status: "CLOSED"
  },
  {
    id: "trd-002",
    timeStr: "8 days ago",
    timestamp: Date.now() - 8 * 86400000,
    event: "FOMC Rate Decision",
    instrument: "ETH-USD.PERP (SoDEX)",
    side: "LONG",
    sizeUsd: 8500,
    quantity: 2.36,
    priceEntry: 3601.70,
    priceExit: 3609.50,
    leverage: 2,
    stopLoss: 3500.0,
    takeProfit: 3800.0,
    pnl: 18.41,
    pnlPercent: 0.22,
    status: "CLOSED"
  },
  {
    id: "trd-001",
    timeStr: "15 days ago",
    timestamp: Date.now() - 15 * 86400000,
    event: "Nonfarm Payrolls (April)",
    instrument: "BTC-USD.PERP (SoDEX)",
    side: "LONG",
    sizeUsd: 25000,
    quantity: 0.385,
    priceEntry: 64935.0,
    priceExit: 66820.0,
    leverage: 3,
    stopLoss: 63800.0,
    takeProfit: 67200.0,
    pnl: 725.72,
    pnlPercent: 2.90,
    status: "CLOSED"
  }
];

export const INITIAL_HOLDINGS: SsiHolding[] = [
  {
    id: "hold-mag7",
    name: "Magnificent 7 Tech Index",
    ticker: "MAG7.ssi",
    allocationPercent: 35,
    currentPrice: 1.45,
    balance: 24137.93,
    valueUsd: 35000,
    dailyChange: -3.85
  },
  {
    id: "hold-defi",
    name: "Decentralized Finance Index",
    ticker: "DEFI.ssi",
    allocationPercent: 25,
    currentPrice: 0.88,
    balance: 28409.09,
    valueUsd: 25000,
    dailyChange: -2.12
  },
  {
    id: "hold-meme",
    name: "Meme Capital Token Index",
    ticker: "MEME.ssi",
    allocationPercent: 10,
    currentPrice: 2.10,
    balance: 4761.90,
    valueUsd: 10000,
    dailyChange: -6.45
  },
  {
    id: "hold-ussi",
    name: "Stable Delta-Neutral Yield",
    ticker: "USSI",
    allocationPercent: 30,
    currentPrice: 1.00,
    balance: 30000.00,
    valueUsd: 30000,
    dailyChange: 0.05
  }
];

export const INITIAL_ROTATION_LOGS: RotationLog[] = [
  {
    id: "rot-001",
    timeStr: "1 hour ago",
    fromTicker: "MAG7.ssi",
    toTicker: "USSI",
    percentage: 15,
    reason: "Hawkish CPI beat (+1.45σ) triggered immediate risk-off rotation. Transferred $14.2K capital from high-beta MAG7 into delta-neutral USSI to shield capital and earn stable basis yield."
  },
  {
    id: "rot-002",
    timeStr: "15 days ago",
    fromTicker: "USSI",
    toTicker: "DEFI.ssi",
    percentage: 10,
    reason: "Soft payrolls data prompted fears of cooling domestic jobs, enhancing rate-cut probabilities. Transferred $10K capital from dry powder USSI into high-conviction DEFI spot for risk-on beta expansion."
  }
];
