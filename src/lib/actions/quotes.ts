'use server'

import { z } from 'zod'
import { authedAction } from '@/lib/safe-action'
import { resolveYahooSymbol } from '@/lib/quotes'

// Live "current price" for the trades table — best-effort, no API key.
//
// Unlike the trade-detail chart (market-data.ts / candles.ts), which needs a
// paid Databento/Polygon key per asset class, this reads Yahoo Finance's
// public chart endpoint: no signup, no .env entry, so it works out of the box
// for every self-host. The tradeoff is that it's unofficial and best-effort —
// a miss (unsupported asset class, symbol Yahoo doesn't recognise, or the
// endpoint being temporarily unreachable) just shows "—" in that row rather
// than blocking the page.
//
// A short in-memory cache keyed by the resolved Yahoo ticker avoids re-fetching
// the same symbol for every row of the table and on every polling tick.

const CACHE_TTL_MS = 30_000

interface CacheEntry {
  price: number | null
  at: number
}

// Process-local: fine for a single self-hosted instance. On a multi-instance
// deployment this simply means each instance warms its own cache — never a
// correctness issue, at worst a few extra Yahoo requests.
const cache = new Map<string, CacheEntry>()

async function fetchYahooLastPrice(yahooSymbol: string): Promise<number | null> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=1d&interval=1m`,
      {
        cache: 'no-store',
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; tradenza-self-hosted)' },
      },
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

async function getCached(yahooSymbol: string): Promise<number | null> {
  const hit = cache.get(yahooSymbol)
  const now = Date.now()
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.price
  const price = await fetchYahooLastPrice(yahooSymbol)
  cache.set(yahooSymbol, { price, at: now })
  return price
}

const quoteRequestSchema = z
  .array(z.object({ assetClass: z.string().min(1), symbol: z.string().min(1) }))
  .max(200)

/**
 * Best-effort current price per requested (assetClass, symbol) pair, keyed by
 * `"${assetClass}:${symbol}"` (the exact strings passed in) so the caller can
 * look results up without re-deriving the Yahoo ticker itself. Every requested
 * pair gets an entry — `null` for "no live price available" — so the caller
 * never has to guess whether a missing key means "still loading" vs. "not
 * supported".
 */
export const getCurrentPrices = authedAction([quoteRequestSchema], async (_ctx, items) => {
  const yahooByKey = new Map<string, string>()
  for (const { assetClass, symbol } of items) {
    const key = `${assetClass}:${symbol}`
    if (yahooByKey.has(key)) continue
    const yahoo = resolveYahooSymbol(assetClass, symbol)
    if (yahoo) yahooByKey.set(key, yahoo)
  }

  const out: Record<string, number | null> = {}
  await Promise.all(
    Array.from(yahooByKey.entries()).map(async ([key, yahoo]) => {
      out[key] = await getCached(yahoo)
    }),
  )
  for (const { assetClass, symbol } of items) {
    const key = `${assetClass}:${symbol}`
    if (!(key in out)) out[key] = null
  }
  return out
})
