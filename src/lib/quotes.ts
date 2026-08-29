// "Current price" symbol mapping for the trades table's live-price column.
//
// The historical candle feeds in market-data.ts (Databento / Polygon) exist
// for the trade-detail chart and need a paid, keyed provider — fine for one
// chart load per trade, not for a live number refreshed on every row of a
// list a self-hoster may never have configured a market-data key for. Yahoo
// Finance's public (unofficial, no key) chart endpoint covers the "one live
// last price" need instead, for the asset classes a symbol maps to it
// reliably.
//
// Pure and side-effect free (no 'use server', no fetch) so the mapping itself
// stays unit-testable; the actual HTTP call lives in lib/actions/quotes.ts.

/**
 * Map an internal (assetClass, symbol) pair to the Yahoo Finance ticker that
 * carries its live price, or null when there is no reliable general mapping.
 * Futures, options and CFDs vary too much broker-to-broker (expiry codes,
 * contract naming) to guess safely, so those simply show no live price rather
 * than risk showing the wrong instrument's.
 */
export function resolveYahooSymbol(assetClass: string, symbol: string): string | null {
  const sym = (symbol || '').toUpperCase().trim()
  if (!sym) return null

  if (assetClass === 'stocks') return sym

  if (assetClass === 'forex') {
    // "EURUSD", "EUR/USD", "EUR-USD" → "EURUSD=X"
    const letters = sym.replace(/[^A-Z]/g, '')
    if (letters.length !== 6) return null
    return `${letters}=X`
  }

  if (assetClass === 'crypto') {
    // "BTCUSD", "BTC/USD", "XBTUSD", "BTCUSDT" → "BTC-USD"
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
