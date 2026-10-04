import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Gốc project (nuxt.config.ts nằm ở root) — alias tự tính, KHÔNG hardcode
// đường dẫn máy khác (bẫy đã gặp khi copy alias của tm-hub sang đây).
const ROOT_DIR = fileURLToPath(new URL('.', import.meta.url))

// pnpm KHÔNG hoist `prosemirror-*` lên node_modules gốc (khác npm) →
// `vite.optimizeDeps.include` bên dưới sẽ không resolve được. Map về virtual
// store `.pnpm/node_modules` — đúng cách tm-hub làm (xem nuxt.config của hub).
// Chỉ gắn alias khi đang chạy pnpm (thư mục tồn tại) để vẫn chạy được với npm.
const PNPM_VIRTUAL = join(ROOT_DIR, 'node_modules', '.pnpm', 'node_modules')
const PROSEMIRROR_PKGS = [
  'prosemirror-state',
  'prosemirror-model',
  'prosemirror-transform',
  'prosemirror-view',
  'prosemirror-history',
  'prosemirror-keymap',
  'prosemirror-commands',
  'prosemirror-inputrules',
  'prosemirror-schema-list',
  'prosemirror-gapcursor',
  'prosemirror-dropcursor',
  'prosemirror-tables'
]
const PROSEMIRROR_ALIASES: Record<string, string> = existsSync(PNPM_VIRTUAL)
  ? Object.fromEntries(PROSEMIRROR_PKGS.map(name => [name, join(PNPM_VIRTUAL, name)]))
  : {}

export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',
  // SPA mode — deploy target: Vercel / Netlify (Nitro still serves /api/** as serverless)
  ssr: false,
  spaLoadingTemplate: 'spa-loading-template.html',
  devtools: { enabled: false },
  experimental: {
    appManifest: false
  },
  alias: {
    '#app-manifest': join(ROOT_DIR, 'shared/stubs/app-manifest.ts')
  },
  modules: [
    '@nuxt/ui',
    '@nuxt/image',
    '@vueuse/nuxt',
    '@nuxtjs/i18n',
    '@pinia/nuxt',
    '@vite-pwa/nuxt'
  ],
  imports: {
    dirs: [
      'shared/utils',
      'shared/google'
    ]
  },
  typescript: {
    tsConfig: {
      include: [
        '../types/**/*.ts',
        '../types/**/*.d.ts'
      ]
    }
  },
  css: ['~/assets/css/main.css'],

  // Avoid @nuxt/icon scanning the entire library at build time (lag on Vercel).
  // Scanning is disabled so dynamic icons (loaded at runtime) resolve normally.
  icon: {
    clientBundle: {
      scan: false
    }
  },

  app: {
    head: {
      charset: 'utf-8',
      viewport: 'width=device-width, initial-scale=1',
      link: [
        { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' },
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' }
      ]
    }
  },

  pwa: {
    registerType: 'autoUpdate',
    manifest: {
      id: 'tm-trading-pwa',
      scope: '/',
      name: 'TM Trading',
      short_name: 'TM Trading',
      description: 'Trade desk tự động: engine tín hiệu + backtest + risk gate',
      theme_color: '#0f172a',
      background_color: '#0f172a',
      display: 'standalone',
      orientation: 'portrait',
      icons: [
        {
          src: '/pwa-192x192.png',
          sizes: '192x192',
          type: 'image/png'
        },
        {
          src: '/pwa-512x512.png',
          sizes: '512x512',
          type: 'image/png'
        },
        {
          src: '/pwa-512x512.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'any maskable'
        }
      ]
    },
    workbox: {
      importScripts: ['/push-sw.js'],
      navigateFallback: '/',
      cleanupOutdatedCaches: true,
      skipWaiting: true,
      clientsClaim: true,
      globIgnores: ['**/node_modules/**/*', 'push-sw.js', 'workbox-*.js'],
      globPatterns: ['**/*.{js,css,html,png,jpg,jpeg,svg,ico}']
    },
    devOptions: {
      enabled: process.env.NODE_ENV === 'development',
      type: 'module',
      suppressWarnings: true
    }
  },

  runtimeConfig: {
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseKey: process.env.SUPABASE_KEY || '',
    toolsAppId: process.env.TOOLS_APP_ID || 'tm-tools',
    jwtSecret: process.env.AUTH_JWT_SECRET || 'super-secure-shared-secret-key-32-chars-min',
    jwtAccessExpiry: process.env.AUTH_ACCESS_TOKEN_EXPIRY || '15m',
    jwtRefreshExpiry: process.env.AUTH_REFRESH_TOKEN_EXPIRY || '7d',
    mongodbLogUri: process.env.MONGODB_LOG_URI || process.env.MONGODB_HISTORY_URI || '',
    mongodbLogDbName: process.env.MONGODB_LOG_DB_NAME || 'tm-hub-logs',
    configEncryptionKey: process.env.CONFIG_ENCRYPTION_KEY || '',
    redisUrl: process.env.REDIS_URL || '',
    redisHost: process.env.REDIS_HOST || 'localhost',
    redisPort: parseInt(process.env.REDIS_PORT || '6379', 10),
    public: {
      // KHÔNG đặt SUPABASE_KEY vào public — nó được serialize vào window.__NUXT__
      // và sẽ lộ service-role key cho trình duyệt (bypass toàn bộ RLS).
      // Toàn bộ truy cập DB đi qua server /api (runtimeConfig.supabaseKey — không public).
      apiPrefix: '/api/v1',
      // --- tm-hub: tm-trading la SATELLITE APP, khong phai provider ---
      // hubAppId = appId lay duoc khi TAO APP trong tm-hub (bat buoc de xac thuc).
      // hubUrl   = dia chi tm-hub; mac dinh 4000 vi do la cong tm-hub dang chay.
      hubUrl: process.env.NUXT_PUBLIC_HUB_URL || process.env.HUB_URL || 'http://localhost:4000',
      hubAppId: process.env.NUXT_PUBLIC_HUB_APP_ID || process.env.HUB_APP_ID || ''
    }
  },
  i18n: {
    locales: [
      { code: 'en', language: 'en', name: 'English', file: 'en.json' },
      { code: 'vi', language: 'vi', name: 'Tiếng Việt', file: 'vi.json' }
    ],
    defaultLocale: 'vi',
    strategy: 'no_prefix',
    detectBrowserLanguage: {
      useCookie: true,
      cookieKey: 'i18n_locale',
      redirectOn: 'root'
    }
  },
  // Nuxt UI Editor (TipTap/ProseMirror): ép TẤT CẢ graphs (@nuxt/ui, @tiptap/*,
  // prosemirror-tables) dùng chung MỘT bản prebundle của prosemirror — 2 bundle
  // riêng gây "Adding different instances of a keyed plugin (plugin$)" /
  // "Duplicate use of selection JSON ID cell".
  // - alias: bare 'prosemirror-*' không resolve được từ app root (pnpm không
  //   hoist) → tm-hub map về virtual store `.pnpm/node_modules`.
  //   ĐÃ BỎ ở tm-trading: đó là đường dẫn TUYỆT ĐỐI trỏ vào máy tm-hub
  //   (D:/Applications/tm-hub/...), chạy ở nơi khác là hỏng. tm-trading dùng npm
  //   nên node_modules hoist phẳng → bare 'prosemirror-*' resolve bình thường.
  // - include: optimize ngay từ đầu, tránh runtime re-optimize flicker (giữ lại).
  vite: {
    plugins: [
      {
        name: 'vite-plugin-fix-app-manifest',
        enforce: 'pre',
        resolveId(id) {
          if (id === '#app-manifest') {
            return '\0virtual:app-manifest'
          }
        },
        load(id) {
          if (id === '\0virtual:app-manifest') {
            return 'export const prerendered = []; export default { prerendered };'
          }
        },
        transform(code, id) {
          if (id.includes('manifest.js') && code.includes('#app-manifest')) {
            return {
              code: code.replace(/import\s*\([^)]*#app-manifest[^)]*\)/gs, 'Promise.resolve({ default: { prerendered: [] }, prerendered: [] })'),
              map: null
            }
          }
        }
      }
    ],
    resolve: {
      // Xem chú thích PROSEMIRROR_ALIASES ở đầu file (pnpm không hoist).
      alias: {
        ...PROSEMIRROR_ALIASES,
        '#app-manifest': join(ROOT_DIR, 'shared/stubs/app-manifest.ts')
      }
    },
    optimizeDeps: {
      exclude: ['#app-manifest'],
      include: [
        'prosemirror-state',
        'prosemirror-model',
        'prosemirror-transform',
        'prosemirror-view',
        'prosemirror-history',
        'prosemirror-keymap',
        'prosemirror-commands',
        'prosemirror-inputrules',
        'prosemirror-schema-list',
        'prosemirror-gapcursor',
        'prosemirror-dropcursor',
        'prosemirror-tables',
        '@tiptap/pm/state',
        '@tiptap/pm/model',
        '@tiptap/pm/transform',
        '@tiptap/pm/view',
        '@tiptap/pm/history',
        '@tiptap/pm/keymap',
        '@tiptap/pm/commands',
        '@tiptap/pm/inputrules',
        '@tiptap/pm/schema-list',
        '@tiptap/pm/gapcursor',
        '@tiptap/pm/dropcursor',
        '@tiptap/pm/tables'
      ]
    }
  },
  nitro: {
    // Không scan server/modules/ thành Nitro modules (đây là domain logic / services nội bộ).
    ignore: ['modules/**', '**/modules/**'],
    routeRules: {
      '/api/**': {
        cors: true,
        headers: {
          'Access-Control-Allow-Methods': 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-App-Id, X-Requested-With'
        }
      }
    }
  }
})
