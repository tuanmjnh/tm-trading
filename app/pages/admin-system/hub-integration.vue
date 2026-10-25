<script setup lang="ts">
import { getErrorMessage } from '~/shared/utils/errors'

definePageMeta({
  alias: ['/admin-system/hub-config', '/admin-system/hub-data']
})

const { t } = useI18n()
const notify = useNotify()
const { hubUrl, appId, hubFetch, client } = useHub()
const auth = useAuth()
const { copy } = useClipboard()

const title = computed(() => t('nav.hub_integration', 'Cấu Hình & Tải Dữ Liệu TM Hub'))
const description = computed(() => t('hub_integration.desc', 'Hướng dẫn chi tiết và kiểm tra trực tiếp cơ chế tải dữ liệu động từ TM Hub Control Plane về TM Trading'))

const trail = computed(() => [
  { label: t('nav.admin_system') },
  { label: title.value }
])

useHead({ title })

// Live testing state
const testing = ref(false)
const testResults = ref<{
  health: { ok: boolean, latencyMs?: number, data?: unknown, error?: string }
  configs: { ok: boolean, count?: number, error?: string }
  routes: { ok: boolean, count?: number, error?: string }
  docs: { ok: boolean, version?: number, error?: string }
} | null>(null)

const copiedKey = ref('')
async function copyCode(key: string, code: string) {
  await copy(code)
  copiedKey.value = key
  setTimeout(() => {
    if (copiedKey.value === key) copiedKey.value = ''
  }, 1500)
}

async function runLiveTest() {
  testing.value = true
  testResults.value = {
    health: { ok: false },
    configs: { ok: false },
    routes: { ok: false },
    docs: { ok: false }
  }

  // 1. Test Health / Ping
  const t0 = Date.now()
  try {
    const res = await $fetch<{ success?: boolean, status?: string }>(`${hubUrl}/api/v1/health`, {
      headers: { 'X-App-Id': appId }
    })
    testResults.value.health = { ok: true, latencyMs: Date.now() - t0, data: res }
  } catch (err) {
    testResults.value.health = { ok: false, error: getErrorMessage(err, k => t(k)) }
  }

  // 2. Test Public Configs
  try {
    const res = await client.configs.getPublic(appId)
    const keysCount = Object.keys(res.data || {}).length
    testResults.value.configs = { ok: true, count: keysCount }
  } catch (err) {
    testResults.value.configs = { ok: false, error: getErrorMessage(err, k => t(k)) }
  }

  // 3. Test Dynamic Routes
  try {
    const res = await hubFetch<{ success: boolean, data: unknown[] }>(`/api/v1/apps/${encodeURIComponent(appId)}/routes`)
    testResults.value.routes = { ok: true, count: Array.isArray(res.data) ? res.data.length : 0 }
  } catch (err) {
    testResults.value.routes = { ok: false, error: getErrorMessage(err, k => t(k)) }
  }

  // 4. Test Dynamic Docs from Hub
  try {
    const res = await hubFetch<{ success: boolean, data: { version: number } }>(`/api/v1/apps/${encodeURIComponent(appId)}/docs`)
    testResults.value.docs = { ok: true, version: res.data?.version }
  } catch (err) {
    testResults.value.docs = { ok: false, error: getErrorMessage(err, k => t(k)) }
  }

  testing.value = false
  notify.success(t('common.success', 'Thành công'), 'Đã hoàn tất kiểm tra kết nối tới TM Hub')
}

const envSnippet = `# tm-trading/.env - Cấu hình kết nối Control Plane
PORT=4001
AUTH_PROVIDER=hub

# 1. URL của TM Hub (chạy local trên 4000 hoặc URL triển khai cloud)
NUXT_PUBLIC_HUB_URL=${hubUrl}

# 2. Định danh AppId đã đăng ký trong bảng apps của TM Hub
NUXT_PUBLIC_HUB_APP_ID=${appId}

# 3. Khóa bí mật JWT dùng chung (phải trùng khớp với AUTH_JWT_SECRET của Hub)
AUTH_JWT_SECRET=24481429ddef2654285b4906225e7f159e6d08a58105dd1231da4d5d07af90d5`

const codeUseHubSnippet = `import { useHub } from '~/composables/useHub'

// Truy xuất client và helper
const { hubUrl, appId, hubFetch, client } = useHub()

// 1. Tải cấu hình công khai (không cần token đăng nhập)
const publicConfigs = await client.configs.getPublic(appId)

// 2. Tải toàn bộ cấu hình hệ thống (kèm JWT token xác thực)
const allConfigs = await hubFetch('/api/v1/apps/' + appId + '/configs')

// 3. Tải tài liệu hướng dẫn động (MongoDB / fallback)
const docsRes = await hubFetch('/api/v1/apps/' + appId + '/docs')`

const codeNavMenuSnippet = `// Tự động tải menu động từ TM Hub qua useNavMenu()
const nav = useNavMenu()
await nav.fetchRoutes()
// Kết quả được map tự động vào NavigationMenuItem[]`

const syncEndpoints = [
  { module: 'Health & Status', method: 'GET', path: '/api/v1/health', desc: 'Kiểm tra độ trễ và trạng thái gateway của TM Hub' },
  { module: 'Remote Configs', method: 'GET', path: '/api/v1/apps/:appId/configs/public', desc: 'Tải các biến cấu hình công khai (Client Firebase, Cloudinary name, VAPID key...)' },
  { module: 'Remote Configs', method: 'GET', path: '/api/v1/apps/:appId/configs', desc: 'Tải toàn bộ cấu hình và API key bí mật sau khi giải mã AES-256' },
  { module: 'Dynamic Routes', method: 'GET', path: '/api/v1/apps/:appId/routes', desc: 'Cây danh mục navigation sidebar được cấp phát theo RBAC từ bảng system_routes' },
  { module: 'Dynamic Docs', method: 'GET', path: '/api/v1/apps/:appId/docs', desc: 'Tải tài liệu và hướng dẫn hệ thống mới nhất lưu trong MongoDB AppContent' },
  { module: 'User Session', method: 'GET', path: '/api/v1/auth/me', desc: 'Đồng bộ hồ sơ người dùng, quyền hạn và session đăng nhập hiện hành' }
]
</script>

<template>
  <BasePage id="hub-integration" :title="title" :description="description">
    <template #eyebrow>
      <BasePageEyebrow :trail="trail" />
    </template>
    <template #right>
      <div class="flex items-center gap-2">
        <UButton
          to="/admin-system/docs"
          icon="i-lucide-book-open"
          variant="ghost"
          size="sm"
          :label="t('nav.docs', 'Tài Liệu API')"
        />
        <UButton
          icon="i-lucide-activity"
          color="primary"
          variant="soft"
          size="sm"
          :loading="testing"
          :label="t('hub_integration.runTest', 'Kiểm tra kết nối')"
          @click="runLiveTest"
        />
      </div>
    </template>

    <div class="flex flex-col gap-6 w-full pb-20">
      <!-- 1. Live Connectivity Test Card -->
      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-network" class="w-5 h-5 text-primary" />
              <h3 class="font-semibold text-sm">Trạng Thái Kết Nối Trực Tiếp Tới TM Hub</h3>
            </div>
            <UBadge
              :color="auth.isAuthenticated.value ? 'success' : 'neutral'"
              variant="subtle"
              size="xs"
              :label="auth.isAuthenticated.value ? 'Đã xác thực JWT' : 'Chưa đăng nhập Hub'"
            />
          </div>
        </template>

        <div class="space-y-4">
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <!-- Health / Ping -->
            <div class="p-3 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900/50 space-y-1.5">
              <div class="flex items-center justify-between">
                <span class="text-xs font-medium text-muted">1. Gateway Health</span>
                <UIcon
                  v-if="testResults?.health.ok"
                  name="i-lucide-check-circle"
                  class="w-4 h-4 text-emerald-500"
                />
                <UIcon
                  v-else-if="testResults?.health.error"
                  name="i-lucide-x-circle"
                  class="w-4 h-4 text-rose-500"
                />
                <span v-else class="w-2 h-2 rounded-full bg-neutral-400" />
              </div>
              <p class="text-sm font-semibold text-highlighted">
                {{ testResults?.health.latencyMs !== undefined ? `${testResults.health.latencyMs} ms` : 'Chưa kiểm tra' }}
              </p>
              <p class="text-[11px] text-muted truncate">
                {{ testResults?.health.error || hubUrl }}
              </p>
            </div>

            <!-- Public Configs -->
            <div class="p-3 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900/50 space-y-1.5">
              <div class="flex items-center justify-between">
                <span class="text-xs font-medium text-muted">2. Public Configs</span>
                <UIcon
                  v-if="testResults?.configs.ok"
                  name="i-lucide-check-circle"
                  class="w-4 h-4 text-emerald-500"
                />
                <UIcon
                  v-else-if="testResults?.configs.error"
                  name="i-lucide-x-circle"
                  class="w-4 h-4 text-rose-500"
                />
                <span v-else class="w-2 h-2 rounded-full bg-neutral-400" />
              </div>
              <p class="text-sm font-semibold text-highlighted">
                {{ testResults?.configs.count !== undefined ? `${testResults.configs.count} keys` : 'Chưa kiểm tra' }}
              </p>
              <p class="text-[11px] text-muted truncate">
                {{ testResults?.configs.error || `AppId: ${appId}` }}
              </p>
            </div>

            <!-- Dynamic Routes -->
            <div class="p-3 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900/50 space-y-1.5">
              <div class="flex items-center justify-between">
                <span class="text-xs font-medium text-muted">3. Dynamic Routes</span>
                <UIcon
                  v-if="testResults?.routes.ok"
                  name="i-lucide-check-circle"
                  class="w-4 h-4 text-emerald-500"
                />
                <UIcon
                  v-else-if="testResults?.routes.error"
                  name="i-lucide-x-circle"
                  class="w-4 h-4 text-rose-500"
                />
                <span v-else class="w-2 h-2 rounded-full bg-neutral-400" />
              </div>
              <p class="text-sm font-semibold text-highlighted">
                {{ testResults?.routes.count !== undefined ? `${testResults.routes.count} routes` : 'Chưa kiểm tra' }}
              </p>
              <p class="text-[11px] text-muted truncate">
                {{ testResults?.routes.error || 'Bảng system_routes' }}
              </p>
            </div>

            <!-- Dynamic Docs -->
            <div class="p-3 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900/50 space-y-1.5">
              <div class="flex items-center justify-between">
                <span class="text-xs font-medium text-muted">4. Dynamic Docs</span>
                <UIcon
                  v-if="testResults?.docs.ok"
                  name="i-lucide-check-circle"
                  class="w-4 h-4 text-emerald-500"
                />
                <UIcon
                  v-else-if="testResults?.docs.error"
                  name="i-lucide-x-circle"
                  class="w-4 h-4 text-rose-500"
                />
                <span v-else class="w-2 h-2 rounded-full bg-neutral-400" />
              </div>
              <p class="text-sm font-semibold text-highlighted">
                {{ testResults?.docs.version !== undefined ? `v${testResults.docs.version}` : 'Chưa kiểm tra' }}
              </p>
              <p class="text-[11px] text-muted truncate">
                {{ testResults?.docs.error || 'MongoDB AppContent' }}
              </p>
            </div>
          </div>

          <div class="flex items-center justify-between pt-2">
            <span class="text-xs text-muted">Nhấn nút bên cạnh để chạy kịch bản kiểm tra toàn diện 4 luồng dữ liệu</span>
            <UButton
              icon="i-lucide-play"
              color="primary"
              variant="soft"
              size="xs"
              :loading="testing"
              label="Bắt đầu Test Ngay"
              @click="runLiveTest"
            />
          </div>
        </div>
      </UCard>

      <!-- 2. Environment Configuration Guide (.env) -->
      <UCard>
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-settings-2" class="w-5 h-5 text-primary" />
            <h3 class="font-semibold text-sm">1. Cấu Hình File .env Trong TM Trading</h3>
          </div>
          <p class="text-xs text-muted mt-1">
            Ứng dụng TM Trading đóng vai trò là Satellite kết nối vào Control Plane của TM Hub thông qua các biến môi trường sau:
          </p>
        </template>

        <div class="overflow-hidden rounded-lg bg-neutral-900 dark:bg-neutral-800 text-neutral-100">
          <div class="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-1.5">
            <span class="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">tm-trading/.env</span>
            <UButton
              :icon="copiedKey === 'env' ? 'i-lucide-check' : 'i-lucide-copy'"
              color="neutral"
              variant="ghost"
              size="xs"
              class="text-neutral-400 hover:text-white"
              @click="copyCode('env', envSnippet)"
            />
          </div>
          <pre class="p-4 text-xs font-mono overflow-x-auto"><code>{{ envSnippet }}</code></pre>
        </div>
      </UCard>

      <!-- 3. SDK & Composable Usage Code -->
      <UCard>
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-code" class="w-5 h-5 text-primary" />
            <h3 class="font-semibold text-sm">2. Cách Gọi Lấy Dữ Liệu Bằng Code Chuẩn Nuxt 4</h3>
          </div>
          <p class="text-xs text-muted mt-1">
            Trong source code của TM Trading, sử dụng composable <code>useHub()</code> được tích hợp sẵn để tương tác với Hub:
          </p>
        </template>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <!-- Code 1: useHub -->
          <div class="space-y-1.5">
            <div class="flex items-center justify-between">
              <span class="text-xs font-medium text-highlighted">Gọi API qua useHub & hubFetch</span>
              <UButton
                :icon="copiedKey === 'useHub' ? 'i-lucide-check' : 'i-lucide-copy'"
                color="neutral"
                variant="ghost"
                size="xs"
                @click="copyCode('useHub', codeUseHubSnippet)"
              />
            </div>
            <div class="overflow-hidden rounded-lg bg-neutral-900 dark:bg-neutral-800 text-neutral-100">
              <pre class="p-3 text-xs font-mono overflow-x-auto"><code>{{ codeUseHubSnippet }}</code></pre>
            </div>
          </div>

          <!-- Code 2: useNavMenu -->
          <div class="space-y-1.5">
            <div class="flex items-center justify-between">
              <span class="text-xs font-medium text-highlighted">Đồng bộ Menu Động (Dynamic Menu)</span>
              <UButton
                :icon="copiedKey === 'useNav' ? 'i-lucide-check' : 'i-lucide-copy'"
                color="neutral"
                variant="ghost"
                size="xs"
                @click="copyCode('useNav', codeNavMenuSnippet)"
              />
            </div>
            <div class="overflow-hidden rounded-lg bg-neutral-900 dark:bg-neutral-800 text-neutral-100">
              <pre class="p-3 text-xs font-mono overflow-x-auto"><code>{{ codeNavMenuSnippet }}</code></pre>
            </div>
          </div>
        </div>
      </UCard>

      <!-- 4. Sync Endpoints Table -->
      <UCard>
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-arrow-left-right" class="w-5 h-5 text-primary" />
            <h3 class="font-semibold text-sm">3. Bảng Chi Tiết Các Endpoint Tải Dữ Liệu</h3>
          </div>
        </template>

        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs border-collapse">
            <thead>
              <tr class="border-b border-neutral-200 dark:border-neutral-800 text-muted font-medium">
                <th class="py-2.5 px-3">Phân loại</th>
                <th class="py-2.5 px-3">Phương thức</th>
                <th class="py-2.5 px-3 font-mono">Đường dẫn Endpoint</th>
                <th class="py-2.5 px-3">Ý nghĩa & Dữ liệu trả về</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-neutral-100 dark:divide-neutral-800/60">
              <tr v-for="ep in syncEndpoints" :key="ep.path" class="hover:bg-neutral-50/50 dark:hover:bg-neutral-900/50">
                <td class="py-2.5 px-3 font-medium whitespace-nowrap text-highlighted">{{ ep.module }}</td>
                <td class="py-2.5 px-3 whitespace-nowrap">
                  <UBadge color="success" variant="subtle" size="xs">{{ ep.method }}</UBadge>
                </td>
                <td class="py-2.5 px-3 font-mono text-primary font-medium whitespace-nowrap">{{ ep.path }}</td>
                <td class="py-2.5 px-3 text-muted">{{ ep.desc }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </UCard>
    </div>
  </BasePage>
</template>
