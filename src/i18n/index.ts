import { createElement, type ReactNode } from 'react'
import { activeLocale, type Locale } from './config'
import common from './locales/en/common.json'
import nav from './locales/en/nav.json'
import header from './locales/en/header.json'
import enums from './locales/en/enums.json'
import datepicker from './locales/en/datepicker.json'
import meta from './locales/en/meta.json'
import landing from './locales/en/landing.json'
import notfound from './locales/en/notfound.json'
import error from './locales/en/error.json'
import errors from './locales/en/errors.json'
import dashboard from './locales/en/dashboard.json'
import stats from './locales/en/stats.json'
import trades from './locales/en/trades.json'
import accounts from './locales/en/accounts.json'
import tradingAccounts from './locales/en/tradingAccounts.json'
import addTrades from './locales/en/addTrades.json'
import settings from './locales/en/settings.json'
import validation from './locales/en/validation.json'
import filters from './locales/en/filters.json'
import editor from './locales/en/editor.json'
import progress from './locales/en/progress.json'
import onboarding from './locales/en/onboarding.json'
import legal from './locales/en/legal.json'
import admin from './locales/en/admin.json'
import feedback from './locales/en/feedback.json'
import strategies from './locales/en/strategies.json'
import adherence from './locales/en/adherence.json'

const en = {
  common,
  nav,
  header,
  enums,
  datepicker,
  meta,
  landing,
  notfound,
  error,
  errors,
  dashboard,
  stats,
  trades,
  accounts,
  tradingAccounts,
  addTrades,
  settings,
  validation,
  filters,
  editor,
  progress,
  onboarding,
  legal,
  admin,
  feedback,
  strategies,
  adherence,
} as const

type Messages = typeof en

// Register additional languages here as they are added. The `Record<Locale, …>`
// type guarantees every supported locale (see i18n/config.ts) has a dictionary.
const dictionaries: Record<Locale, Messages> = { en }

type Params = Record<string, string | number>

function resolve(key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>(
      (acc, part) => (acc != null ? (acc as Record<string, unknown>)[part] : undefined),
      dictionaries[activeLocale],
    )
}

/**
 * ICU-style plural forms: `{count, plural, one {# trade} other {# trades}}`. Hand-written
 * because this is the only piece of ICU the app uses. `#` stands in for the number and
 * categories come from Intl.PluralRules, so a language with `few` / `many` needs a
 * dictionary entry, not a code change; an unmatched category falls back to `other`.
 */
const PLURAL_RE = /\{(\w+),\s*plural,\s*((?:\s*\w+\s*\{[^{}]*\})+)\}/g

const pluralRules = new Intl.PluralRules(activeLocale)

function applyPlurals(text: string, params: Params): string {
  return text.replace(PLURAL_RE, (whole, key: string, body: string) => {
    const raw = params[key]
    if (raw === undefined) return whole
    const n = Number(raw)
    if (!Number.isFinite(n)) return whole

    const forms = new Map<string, string>()
    for (const [, name, form] of body.matchAll(/(\w+)\s*\{([^{}]*)\}/g)) forms.set(name, form)

    // An exact `=0` / `=1` match wins over the grammatical category.
    const chosen = forms.get(`=${n}`) ?? forms.get(pluralRules.select(n)) ?? forms.get('other')
    return chosen === undefined ? whole : chosen.replace(/#/g, String(raw))
  })
}

export function t(key: string, params?: Params): string {
  const val = resolve(key)
  if (typeof val !== 'string') return key
  if (!params) return val
  return applyPlurals(val, params).replace(/\{(\w+)\}/g, (_, k) =>
    params[k] !== undefined ? String(params[k]) : `{${k}}`,
  )
}

export function tRich(key: string, params?: Params): ReactNode {
  const val = resolve(key)
  if (typeof val !== 'string') return key
  if (!params) return val
  // Plurals are already resolved, so only simple `{name}` placeholders are left to split.
  const parts = applyPlurals(val, params).split(/(\{\w+\})/g)
  return parts.map((part, i) => {
    const m = part.match(/^\{(\w+)\}$/)
    if (m && params[m[1]] !== undefined) {
      return createElement('strong', { key: i, className: 'font-semibold text-foreground' }, String(params[m[1]]))
    }
    return part
  })
}

export function tList(key: string): string[] {
  const val = resolve(key)
  return Array.isArray(val) ? (val as string[]) : []
}

/** Resolve an array of arbitrary (typed) objects from the dictionary. */
export function tArray<T = unknown>(key: string): T[] {
  const val = resolve(key)
  return Array.isArray(val) ? (val as T[]) : []
}
