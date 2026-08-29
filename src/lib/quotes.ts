// "Current price" symbol mapping for the trades table's live-price column.
//
// The historical candle feeds in market-data.ts (Databento / Polygon) exist
// for the trade-detail chart and need a paid, keyed provider — fine for one
// chart load per trade, not for a live number refreshed on every row of a
// list a self-hoster may never have configured a market-data key for.
//
// Two free, keyless sources cover the "one current price" need instead:
//   - Stooq        → primary. A plain CSV "last quote" endpoint built for
//                    exactly this, with no signup and no rate-limit wall for
//                    light personal use.
//   - Yahoo Finance → fallback, for whatever Stooq doesn't cover (Yahoo's
//                    unofficial endpoint is more complete for some tickers
//                    but also more prone to being rate-limited or blocked
//                    outright for server-side, unauthenticated callers).
//
// Pure and side-effect free (no 'use server', no fetch) so the mapping itself
// stays unit-testable; the actual HTTP calls live in lib/actions/quotes.ts.

/**
 * Map an internal (assetClass, symbol) pair to the Stooq ticker that carries
 * its last quote, or null when there is no reliable general mapping. Futures,
 * options and CFDs vary too much broker-to-broker (expiry codes, contract
 * naming) to guess safely, so those simply show no live price rather than
 * risk showing the wrong instrument's.
 */
export function resolveStooqSymbol(assetClass: string, symbol: string): string | null {
  const sym = (symbol || '').toUpperCase().trim()
  if (!sym) return null

  // Stooq's US-equity tickers carry an explicit market suffix ("AAPL.US");
  // without it the same letters can resolve to a different exchange's listing.
  if (assetClass === 'stocks') return `${sym}.US`

  if (assetClass === 'forex') {
    // "EURUSD", "EUR/USD", "EUR-USD" → "EURUSD"
    const letters = sym.replace(/[^A-Z]/g, '')
    if (letters.length !== 6) return null
    return letters
  }

  if (assetClass === 'crypto') {
    // "BTCUSD", "BTC/USD", "XBTUSD", "BTCUSDT" → "BTCUSD"
    let s = sym.replace(/[^A-Z]/g, '')
    if (s.startsWith('XBT')) s = 'BTC' + s.slice(3)
    const quote = ['USDT', 'USDC', 'USD'].find((q) => s.endsWith(q))
    if (!quote) return null
    const base = s.slice(0, -quote.length)
    if (!base) return null
    return `${base}USD`
  }

  return null
}

/**
 * Map an internal (assetClass, symbol) pair to the Yahoo Finance ticker that
 * carries its live price — used as a fallback when Stooq has no quote for the
 * symbol. See {@link resolveStooqSymbol} for the asset-class caveats, which
 * apply identically here.
 */
export function resolveYahooSymbol(assetClass: string, symbol: string): string | null {
  const sym = (symbol || '').toUpperCase().trim()
  if (!sym) return null

  if (assetClass === 'stocks') return sym

  if (assetClass === 'forex') {
    const letters = sym.replace(/[^A-Z]/g, '')
    if (letters.length !== 6) return null
    return `${letters}=X`
  }

  if (assetClass === 'crypto') {
    let s = sym.replace(/[^A-Z]/g, '')
    if (s.startsWith('XBT')) s = 'BTC' + s.slice(3)
    const quote = ['USDT', 'USDC', 'USD'].find((q) => s.endsWith(q))
    if (!quote) return null
    const base = s.slice(0, -quote.length)
    if (!base) return null
    return `${base}-USD`
  }

  return null
}
