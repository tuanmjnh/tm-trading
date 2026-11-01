<script setup lang="ts">
// V4.2 §1 Intelligence workspace — news, market events, the macro calendar and
// the evidence-backed outlook. Panels reuse the existing pages directly (see
// components/workspace/Shell.vue). The reused leaves stay routable as deep links.
import NewsDeskPage from '~/pages/news/index.vue'
import NewsEventsPage from '~/pages/news/events.vue'
import MarketCalendarPage from '~/pages/markets/calendar.vue'
import OutlookPage from '~/pages/outlook.vue'

const tabs = [
  { key: 'news', icon: 'i-lucide-newspaper', component: NewsDeskPage },
  { key: 'events', icon: 'i-lucide-calendar-clock', component: NewsEventsPage },
  { key: 'calendar', icon: 'i-lucide-calendar-days', component: MarketCalendarPage },
  { key: 'outlook', icon: 'i-lucide-telescope', component: OutlookPage }
]
</script>

<template>
  <WorkspaceShell namespace="intelligenceWorkspace" :tabs="tabs" />
</template>
