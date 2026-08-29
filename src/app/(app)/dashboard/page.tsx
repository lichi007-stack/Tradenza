import { getDashboardWidgetData, getDashboardTemplates, getCalendarData } from '@/lib/actions/dashboard'
import { hasAnyTrades } from '@/lib/actions/trades'
import { readGlobalFilters } from '@/lib/global-filters'
import DashboardClient from '@/components/dashboard/DashboardClient'
import DemoNotice from '@/components/onboarding/DemoNotice'
import { t } from '@/i18n'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: t('meta.dashboard') }

export default async function DashboardPage() {
  const now = new Date()
  const [data, dashboards, filters, hasTrades] = await Promise.all([
    getDashboardWidgetData(),
    getDashboardTemplates(),
    readGlobalFilters(),
    hasAnyTrades(),
  ])
  const calendarInitial = await getCalendarData(now.getFullYear(), now.getMonth() + 1)

  return (
    <div className="p-5 w-full animate-in">
      {!hasTrades && <DemoNotice context="dashboard" />}
      <DashboardClient
        data={data}
        calendarInitial={calendarInitial}
        currency="USD"
        unit={filters.unit}
        layout={dashboards.layout}
        activeTemplate={dashboards.active}
        templates={dashboards.templates}
      />
    </div>
  )
}
