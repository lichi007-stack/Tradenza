'use server'

import { z } from 'zod'
import { authedAction } from '@/lib/safe-action'
import { resolveStooqSymbol, resolveYahooSymbol } from '@/lib/quotes'

// Live "current price" for the trades table — best-effort, no API key.
//
// Unlike the trade-detail chart (market-data.ts / candles.ts), which needs a
// paid Databento/Polygon key per asset class, this needs no signup and no
// .env entry, so it works out of the box for every self-host. Two free
// sources are tried in order:
//   1. Stooq        — a plain CSV "last quote" endpoint built for exactly this.
//   2. Yahoo Finance — unofficial fallback for whatever Stooq has no quote for.
// Both are unofficial-but-public and best-effort: a miss (unsupported asset
// class, a symbol neither source recognises, or a source being temporarily
// unreachable/rate-limiting us) just shows "—" in that row rather than
// blocking the page.
//
// A short in-memory cache keyed by "provider:ticker" avoids re-fetching the
// same symbol for every row of the table and on every polling tick.

const CACHE_TTL_MS = 30_000

interface CacheEntry {
  price: number | null
  at: number
}

// Process-local: fine for a single self-hosted instance. On a multi-instance
// deployment this simply means each instance warms its own cache — never a
// correctness issue, at worst a few extra requests to Stooq/Yahoo.
const cache = new Map<string, CacheEntry>()

const FETCH_HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; tradenza-self-hosted)' }

/**
 * Stooq's "/q/l/" endpoint returns one CSV line per requested ticker:
 * `Symbol,Date,Time,Open,High,Low,Close,Volume`. A ticker it doesn't
 * recognise, or one with no trade yet, comes back with "N/D" ("no data") in
 * place of every price field rather than an HTTP error — so that has to be
 * checked explicitly, not just `res.ok`.
 */
async function fetchStooqLastPrice(stooqSymbol: string): Promise<number | null> {
  try {
    const res = await fetch(
      `https://stooq.com/q/l/?s=${encodeURIComponent(stooqSymbol.toLowerCase())}&f=sd2t2ohlcv&h&e=csv`,
      { cache: 'no-store', headers: FETCH_HEADERS },
    )
    if (!res.ok) return null
    const text = await res.text()
    const lines = text.trim().split('\n')
    if (lines.length < 2) return null
    // Header is `lines[0]`; the quote itself is the one data row after it.
    const cols = lines[1].split(',')
    const close = cols[6]
    if (!close || close === 'N/D') return null
    const price = Number(close)
    return Number.isFinite(price) && price > 0 ? price : null
  } catch {
    return null
  }
}

async function fetchYahooLastPrice(yahooSymbol: string): Promise<number | null> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=1d&interval=1m`,
      { cache: 'no-store', headers: FETCH_HEADERS },
    )
    if (!res.ok) return null
    const data = (await res.json()) as {
      chart?: { result?: { meta?: { regularMarketPrice?: number } }[] }
    }
    const price = data.chart?.result?.[0]?.meta?.regularMarketPrice
    return typeof price === 'number' && Number.isFinite(price) ? price : null
  } catch {
    return null
  }
}

/** Stooq first (more reliable for unauthenticated server-side use), Yahoo as fallback. */
async function fetchLastPrice(assetClass: string, symbol: string): Promise<number | null> {
  const stooqSymbol = resolveStooqSymbol(assetClass, symbol)
  if (stooqSymbol) {
    const price = await fetchStooqLastPrice(stooqSymbol)
    if (price !== null) return price
  }
  const yahooSymbol = resolveYahooSymbol(assetClass, symbol)
  if (yahooSymbol) return fetchYahooLastPrice(yahooSymbol)
  return null
}

async function getCached(assetClass: string, symbol: string): Promise<number | null> {
  const cacheKey = `${assetClass}:${symbol}`
  const hit = cache.get(cacheKey)
  const now = Date.now()
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.price
  const price = await fetchLastPrice(assetClass, symbol)
  cache.set(cacheKey, { price, at: now })
  return price
}

const quoteRequestSchema = z
  .array(z.object({ assetClass: z.string().min(1), symbol: z.string().min(1) }))
  .max(200)

/**
 * Best-effort current price per requested (assetClass, symbol) pair, keyed by
 * `"${assetClass}:${symbol}"` (the exact strings passed in). Every requested
 * pair gets an entry — `null` for "no live price available from either
 * source" — so the caller never has to guess whether a missing key means
 * "still loading" vs. "not supported".
 */
export const getCurrentPrices = authedAction([quoteRequestSchema], async (_ctx, items) => {
  const unique = new Map<string, { assetClass: string; symbol: string }>()
  for (const { assetClass, symbol } of items) {
    const key = `${assetClass}:${symbol}`
    if (!unique.has(key)) unique.set(key, { assetClass, symbol })
  }

  const out: Record<string, number | null> = {}
  await Promise.all(
    Array.from(unique.entries()).map(async ([key, { assetClass, symbol }]) => {
      out[key] = await getCached(assetClass, symbol)
    }),
  )
  return out
})
