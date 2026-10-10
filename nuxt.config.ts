import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT_DIR = fileURLToPath(new URL('.', import.meta.url))

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
const PROSEMIRROR_ALIASES = existsSync(PNPM_VIRTUAL)
  ? Object.fromEntries(PROSEMIRROR_PKGS.map(name => [name, join(PNPM_VIRTUAL, name)]))
  : {}

export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',
  ssr: false,
  spaLoadingTemplate: 'spa-loading-template.html',
  devtools: { enabled: false },
  sourcemap: { client: true, server: false },
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
  devServer: {
    host: '0.0.0.0', // Allow access from other devices on the same network
    port: 4001,
  },
  pwa: {
    injectRegister: false,
    manifest: {
      id: 'tm-trading-pwa',
      scope: '/',
      name: 'TM Trading',
      short_name: 'TM Trading',
      description: 'Automated trading desk: signal engine + backtesting + risk gate',
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
      apiPrefix: '/api/v1',
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
      alias: {
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
        '@tiptap/pm/tables',
        '@tiptap/pm/tables'
      ]
    }
  },
  nitro: {
    ignore: ['modules/**', '**/modules/**'],
    experimental: { websocket: true },
    alias: {
      services: join(ROOT_DIR, 'services') + '/',
    },
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
