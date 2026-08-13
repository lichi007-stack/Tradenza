import { Suspense } from 'react'
import type { Metadata } from 'next'
import { getStrategyOverview } from '@/lib/actions/strategies'
import { readGlobalFilters } from '@/lib/global-filters'
import StrategiesClient, { type StrategiesTab } from '@/components/strategies/StrategiesClient'
import { StrategiesListSkeleton } from '@/components/strategies/StrategiesSkeletons'
import { t } from '@/i18n'

export const metadata: Metadata = { title: t('strategies.title') }

const TABS: StrategiesTab[] = ['setups', 'adherence', 'criteria']

export default async function StrategiesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | undefined }>
}) {
  const sp = await searchParams
  const initialTab = TABS.find((tab) => tab === sp.tab) ?? 'setups'

  return (
    <div className="p-4 sm:p-6 w-full animate-in">
      <Suspense fallback={<StrategiesListSkeleton />}>
        <StrategiesContent initialTab={initialTab} />
      </Suspense>
    </div>
  )
}

async function StrategiesContent({ initialTab }: { initialTab: StrategiesTab }) {
  // Only the setups list is loaded here; the other tabs fetch their heavier data when
  // first opened. `filtersKey` changes on every header-filter change, which is what tells
  // those client tabs to refetch instead of freezing at the filter active on load.
  const [strategies, filters] = await Promise.all([getStrategyOverview(), readGlobalFilters()])
  return <StrategiesClient strategies={strategies} initialTab={initialTab} filtersKey={JSON.stringify(filters)} />
}
