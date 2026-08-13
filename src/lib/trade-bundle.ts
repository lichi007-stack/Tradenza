import { z } from 'zod'

/**
 * The full-fidelity trade interchange format.
 *
 * The CSV export exists to be opened in a spreadsheet: it flattens a trade into
 * the columns a human wants to read, and in doing so drops everything that has
 * no natural column — the risk plan and individual fills stored in `extra`, the
 * checklist progress, the tag's group and colour, the screenshots. That is fine
 * for reading and useless for moving a journal somewhere else, because a trade
 * imported back from it is not the trade that was exported.
 *
 * This bundle is the other half: a versioned JSON document that carries every
 * field a trade actually has, so an export followed by an import reproduces the
 * trade exactly — same notes, same R:R, same stops and targets, same tags, same
 * screenshots.
 *
 * Two deliberate choices make it portable across users and installations:
 *
 *  - **Nothing is referenced by database id.** Strategies and tags are named,
 *    not keyed, because the receiving user's rows have different ids (and may
 *    not exist at all). Import resolves them by name and creates what is
 *    missing.
 *  - **Images are referenced by URL, not embedded.** Import copies each object
 *    into the receiving user's own storage, so the imported trade does not
 *    depend on the exporter's bucket staying alive. Keeping the bytes out of
 *    the JSON is what lets a thousand-trade journal stay a few megabytes.
 */
export const TRADE_BUNDLE_FORMAT = 'tradenza.trades'
/**
 * 2 — adherence. Carries the checklist items and keys progress by criterion label rather
 * than row id, for the same reason strategies and tags travel by name. Version 1 bundles
 * still import; their `entry`/`exit` arrays are read as the setup and exit blocks.
 */
export const TRADE_BUNDLE_VERSION = 2

/** Upper bound on trades per bundle, mirroring the CSV import's row ceiling. */
export const MAX_BUNDLE_TRADES = 10000

/**
 * Largest backup file the browser will read.
 *
 * The import sends the parsed bundle as a server-action argument, so this has
 * to stay below `serverActions.bodySizeLimit` in `next.config.js` — otherwise
 * the request dies at the framework boundary with a message no user can act on,
 * instead of here where we can say which file was too big. Images live in
 * object storage rather than in the file, so even a full journal is far smaller
 * than this; a bigger file means something is wrong, not that the journal grew.
 */
export const MAX_BUNDLE_BYTES = 10 * 1024 * 1024

// ─── Primitives ───────────────────────────────────────────────────────────────

// Money and quantities travel as strings, exactly as Postgres `numeric` hands
// them to us. Round-tripping them through a JS number would quietly re-round
// values the database stores to 8 decimal places.
const decimal = z
  .string()
  .max(40)
  .refine((s) => s.trim() !== '' && Number.isFinite(Number(s)), 'Not a number')

const timestamp = z
  .string()
  .max(40)
  .refine((s) => !Number.isNaN(Date.parse(s)), 'Not a date')

const url = z.string().max(2048)
const name = z.string().trim().min(1).max(120)
const color = z.string().max(32)

const nullish = <T extends z.ZodTypeAny>(schema: T) => schema.nullish().transform((v) => v ?? null)

// ─── Bundle parts ─────────────────────────────────────────────────────────────

export const bundleTagSchema = z.object({
  /** Group the tag belongs to, by name. `null` = the ungrouped bucket. */
  group: nullish(name),
  name,
  color: nullish(color),
})

export const bundleTagGroupSchema = z.object({
  name,
  color: nullish(color),
  sortOrder: nullish(z.number().int()),
})

export const bundleStrategySchema = z.object({
  name,
  description: nullish(z.string().max(20000)),
  /** Version 1 only — superseded by `checklistItems`. Still read on import. */
  entryChecklist: nullish(z.array(z.string().max(500)).max(200)),
  exitChecklist: nullish(z.array(z.string().max(500)).max(200)),
  imageUrls: nullish(z.array(url).max(50)),
  color: nullish(color),
  sortOrder: nullish(z.number().int()),
})

const dayKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const bundleChecklistItemSchema = z.object({
  /** Owning strategy by name; null = universal. */
  strategy: nullish(name),
  block: z.enum(['gate', 'setup', 'exit']),
  label: z.string().trim().min(1).max(500),
  definition: nullish(z.string().max(2000)),
  sortOrder: nullish(z.number().int()),
  /** First day the criterion governed a trade — what keeps history from re-scoring. */
  effectiveFrom: nullish(dayKey),
})

/**
 * A trade's adherence, keyed by label so it survives the crossing into another journal.
 * `scored` is what keeps an unassessed block distinguishable from a failed one.
 */
const bundleBlockProgressSchema = z.object({
  scored: z.boolean(),
  met: z.array(z.string().max(500)).max(200),
  scoredAt: nullish(timestamp),
})

const bundleAdherenceSchema = z.object({
  v: z.literal(2),
  blocks: z.object({
    gate: bundleBlockProgressSchema,
    setup: bundleBlockProgressSchema,
    exit: bundleBlockProgressSchema,
  }),
})

export const bundleScreenshotSchema = z.object({
  url,
  label: nullish(z.string().max(120)),
  sortOrder: nullish(z.number().int()),
})

export const bundleTradeSchema = z.object({
  /** Id in the source database. Kept only to make an export traceable. */
  sourceId: nullish(z.string().max(64)),
  /** Dedup key. Carried over verbatim so re-importing a bundle is a no-op. */
  externalId: nullish(z.string().max(255)),
  importSource: nullish(z.string().max(60)),

  symbol: z.string().trim().min(1).max(40),
  direction: z.enum(['long', 'short']),
  status: z.enum(['open', 'closed', 'cancelled']),
  assetClass: z.enum(['stocks', 'futures', 'forex', 'crypto', 'options', 'cfd', 'other']),

  entryPrice: decimal,
  entryQuantity: decimal,
  entryDatetime: timestamp,
  exitPrice: nullish(decimal),
  exitQuantity: nullish(decimal),
  exitDatetime: nullish(timestamp),

  fees: nullish(decimal),
  grossPnl: nullish(decimal),
  netPnl: nullish(decimal),

  stopLoss: nullish(decimal),
  takeProfit: nullish(decimal),
  riskRewardRatio: nullish(decimal),
  riskAmount: nullish(decimal),

  checklistProgress: nullish(
    z.union([
      bundleAdherenceSchema,
      z.object({
        entry: z.array(z.string().max(500)).max(200),
        exit: z.array(z.string().max(500)).max(200),
      }),
    ]),
  ),

  setupName: nullish(z.string().max(200)),
  notes: nullish(z.string().max(200000)),
  // Clamped rather than rejected: the app rates a trade 0–5, and one
  // hand-edited value out of range is no reason to refuse the whole journal.
  rating: nullish(z.number().transform((n) => Math.min(5, Math.max(0, n)))),

  /** Executions, contract multiplier and risk plan — the sidebar's source of truth. */
  extra: nullish(z.record(z.unknown())),

  /** Strategy by name; resolved or created on import. */
  strategy: nullish(name),
  tags: z.array(bundleTagSchema).max(100).default([]),
  screenshots: z.array(bundleScreenshotSchema).max(50).default([]),
})

export const tradeBundleSchema = z.object({
  format: z.literal(TRADE_BUNDLE_FORMAT),
  /** Reader accepts anything it knows; unknown future versions are rejected. */
  version: z.number().int().min(1).max(TRADE_BUNDLE_VERSION),
  exportedAt: nullish(timestamp),
  source: nullish(
    z.object({
      app: z.string().max(60).optional(),
      appVersion: z.string().max(40).optional(),
      account: z.string().max(200).optional(),
    }),
  ),
  tagGroups: z.array(bundleTagGroupSchema).max(500).default([]),
  strategies: z.array(bundleStrategySchema).max(500).default([]),
  /** Version 2+. Absent on a v1 bundle, whose criteria live on the strategies. */
  checklistItems: z.array(bundleChecklistItemSchema).max(2000).default([]),
  trades: z.array(bundleTradeSchema).min(1).max(MAX_BUNDLE_TRADES),
})

export type BundleTag = z.infer<typeof bundleTagSchema>
export type BundleTagGroup = z.infer<typeof bundleTagGroupSchema>
export type BundleStrategy = z.infer<typeof bundleStrategySchema>
export type BundleChecklistItem = z.infer<typeof bundleChecklistItemSchema>
export type BundleAdherence = z.infer<typeof bundleAdherenceSchema>
export type BundleScreenshot = z.infer<typeof bundleScreenshotSchema>
export type BundleTrade = z.infer<typeof bundleTradeSchema>
export type TradeBundle = z.infer<typeof tradeBundleSchema>

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Key a strategy or tag is matched by on import. Case and surrounding
 * whitespace are noise here — a user who wrote "Breakout" in one account and
 * "breakout " in another means the same thing, and creating a second row for it
 * would silently split their stats.
 */
export function matchKey(value: string): string {
  return value.trim().toLowerCase()
}

/**
 * Key a tag is matched by, scoped to its group so two groups can share a name.
 *
 * The separator is NUL because a printable one collides: with a space, group
 * "Setup" + tag "late entry" and group "Setup late" + tag "entry" produce the
 * same key. Written as the `\u0000` escape rather than a raw byte -- a literal
 * NUL makes the whole source file read as binary to grep, diffs and review
 * tools (mergeRoundTripPartials learned the same lesson).
 */
export function tagKey(group: string | null, tagName: string): string {
  return `${group ? matchKey(group) : ''}\u0000${matchKey(tagName)}`
}

/**
 * Dedup key for a trade that arrives without one. Symbol, entry time and
 * direction identify a position well enough that re-importing the same bundle
 * is a no-op, which is the property that matters: an import that silently
 * doubles a journal is worse than one that skips too much.
 */
export function derivedExternalId(trade: { symbol: string; entryDatetime: string | Date; direction: string }): string {
  const iso = trade.entryDatetime instanceof Date ? trade.entryDatetime.toISOString() : trade.entryDatetime
  return `${trade.symbol.toUpperCase()}_${new Date(iso).toISOString()}_${trade.direction}`
}

/** Filename for a downloaded bundle, e.g. `tradenza-backup-2026-08-05.json`. */
export function bundleFilename(date = new Date()): string {
  return `tradenza-backup-${date.toISOString().slice(0, 10)}.json`
}

/**
 * Parse an uploaded file's text into a bundle, with errors a user can act on.
 * Returned rather than thrown: the caller is a file picker, and "this isn't a
 * Tradenza export" is an expected outcome there, not an exception.
 */
export function parseTradeBundle(text: string): { ok: true; bundle: TradeBundle } | { ok: false; reason: string } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, reason: 'notJson' }
  }
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'notBundle' }
  const doc = raw as Record<string, unknown>
  if (doc.format !== TRADE_BUNDLE_FORMAT) return { ok: false, reason: 'notBundle' }
  if (typeof doc.version === 'number' && doc.version > TRADE_BUNDLE_VERSION) {
    return { ok: false, reason: 'newerVersion' }
  }
  const parsed = tradeBundleSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, reason: 'invalid' }
  return { ok: true, bundle: parsed.data }
}
