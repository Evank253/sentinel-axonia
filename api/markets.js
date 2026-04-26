Evan Ketchum, [4/25/2026 12:43 PM]
// api/markets.js
// SENTINEL Markets Proxy — Yahoo Finance via server-side fetch (no CORS issues)

const SYMBOLS = {
  indexes: ['^GSPC', '^DJI', '^IXIC', '^VIX', '^RUT', '^FTSE', '^N225'],
  forex: ['EURUSD=X', 'GBPUSD=X', 'USDJPY=X', 'DX-Y.NYB', 'USDCNY=X'],
  commodities: ['CL=F', 'GC=F', 'SI=F', 'NG=F', 'HG=F', 'BZ=F'],
  defense: ['LMT', 'RTX', 'NOC', 'GD', 'BA', 'HII', 'KTOS'],
};

const LABELS = {
  '^GSPC': 'S&P 500', '^DJI': 'DOW', '^IXIC': 'NASDAQ', '^VIX': 'VIX',
  '^RUT': 'RUSSELL 2K', '^FTSE': 'FTSE 100', '^N225': 'NIKKEI',
  'EURUSD=X': 'EUR/USD', 'GBPUSD=X': 'GBP/USD', 'USDJPY=X': 'USD/JPY',
  'DX-Y.NYB': 'DXY', 'USDCNY=X': 'USD/CNY',
  'CL=F': 'CRUDE OIL', 'GC=F': 'GOLD', 'SI=F': 'SILVER',
  'NG=F': 'NAT GAS', 'HG=F': 'COPPER', 'BZ=F': 'BRENT',
  'LMT': 'Lockheed Martin', 'RTX': 'RTX Corp', 'NOC': 'Northrop Grumman',
  'GD': 'General Dynamics', 'BA': 'Boeing', 'HII': 'Hunt. Ingalls', 'KTOS': 'Kratos',
};

const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

async function fetchQuote(symbol) {
  const cached = cache.get(symbol);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  try {
    const url = https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SentinelBot/3.2)', 'Accept': 'application/json' },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) throw new Error(`Yahoo returned ${res.status}`);
    const data = await res.json();
    const result = data.chart?.result?.[0];
    if (!result) throw new Error('No chart result');
    const meta = result.meta;
    const price = meta.regularMarketPrice || meta.previousClose;
    const prev = meta.previousClose || meta.chartPreviousClose;
    const change = prev ? ((price - prev) / prev) * 100 : 0;
    const timestamps = result.timestamp || [];
    const closes = result.indicators?.quote?.[0]?.close || [];
    const history = timestamps.map((t, i) => ({
      t: new Date(t * 1000).toISOString(),
      v: closes[i] ? parseFloat(closes[i].toFixed(4)) : null,
    })).filter(p => p.v !== null);
    const quote = {
      symbol, label: LABELS[symbol] || symbol,
      price: parseFloat(price.toFixed(4)),
      change: parseFloat(change.toFixed(3)),
      previousClose: parseFloat(prev.toFixed(4)),
      currency: meta.currency || 'USD',
      marketState: meta.marketState || 'UNKNOWN',
      history, source: 'Yahoo Finance',
    };
    cache.set(symbol, { data: quote, ts: Date.now() });
    return quote;
  } catch (e) {
    return { symbol, label: LABELS[symbol] || symbol, price: null, change: null, error: e.message, source: 'UNAVAILABLE' };
  }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) return res.status(401).json({ error: 'Missing X-API-Key' });
  const { validateKey } = await import('../lib/auth.js');
  const user = validateKey(apiKey);
  if (!user) return res.status(403).json({ error: 'Invalid API key' });

  const { category = 'all', symbols: customSymbols } = req.query;
  let symsToFetch = customSymbols ? customSymbols.split(',').slice(0, 20)
    : category === 'all' ? [...SYMBOLS.indexes, ...SYMBOLS.forex, ...SYMBOLS.commodities, ...SYMBOLS.defense]
    : SYMBOLS[category] || SYMBOLS.indexes;

  const results = await Promise.all(symsToFetch.map(fetchQuote));
  const grouped = {
    indexes: results.filter(r => SYMBOLS.indexes.includes(r.symbol)),
    forex: results.filter(r => SYMBOLS.forex.includes(r.symbol)),
    commodities: results.filter(r => SYMBOLS.commodities.includes(r.symbol)),
    defense: results.filter(r => SYMBOLS.defense.includes(r.symbol)),
  };
  return res.status(200).json({
    quotes: results, grouped,
    summary: {
      sp500: results.find(r => r.symbol === '^GSPC'),
      oil: results.find(r => r.symbol === 'CL=F'),
      gold: results.find(r => r.symbol === 'GC=F'),
      vix: results.find(r => r.symbol === '^VIX'),

Evan Ketchum, [4/25/2026 12:43 PM]
},
    timestamp: new Date().toISOString(),
    user: user.username,
  });
}
