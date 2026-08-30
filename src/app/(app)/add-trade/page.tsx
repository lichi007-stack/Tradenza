import { redirect } from 'next/navigation'
import AccountsList from '@/components/accounts/AccountsList'
import { getAccounts } from '@/lib/actions/accounts'
import { t } from '@/i18n'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: t('meta.tradingAccounts') }

export default async function AddTradePage() {
  const accounts = await getAccounts(true)

  // getAccounts guarantees at least one account always exists (see
  // provisionGenericIfEmpty), so a single-account trader — the common case for
  // a self-hoster running this for themselves — never needs to see an
  // "which account?" picker with only one possible answer. Multi-account
  // users still get the picker as before.
  if (accounts.length === 1) redirect(`/add-trade/${accounts[0].id}`)

  return (
    <div className="p-4 sm:p-6 w-full animate-in">
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">{t('tradingAccounts.pageTitle')}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">{t('tradingAccounts.pageSubtitle')}</p>
      </div>
      <AccountsList accounts={accounts} title={t('tradingAccounts.cardTitle')} />
    </div>
  )
}
