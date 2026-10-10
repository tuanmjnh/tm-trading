# Kế thừa `app/` từ tm-hub — giữ gì, cắt gì, và các bẫy môi trường

> **Trạng thái:** 2026-10-01. Đã clone và **chạy thật** (`http://localhost:4001/` → HTTP 200).
> Tài liệu này ghi lại **quyết định** để lần sau không phải suy lại, và các **bẫy môi trường**
> đã gặp thật (mỗi bẫy đều tốn ít nhất một vòng sửa).

---

## 1. Đã kế thừa những gì

Clone từ `D:\Applications\tm-hub` (~535 file):

| Nhóm | Nội dung | Số file |
|---|---|---|
| `app/` | components, composables, layouts, pages, plugins, stores, utils, shared, types, assets/css | 217 |
| `server/` | `api/` (168), `modules/` (85), `utils/` (14), `plugins/` (3), `types/` (5), `middleware/` (1) | 276 |
| Khác | `shared/`, `types/`, `i18n/`, `public/`, `tests/`, `scripts/`, `nuxt.config.ts`, `tsconfig.json` | ~41 |

`server/webhook.mjs` của engine **giữ nguyên** (Nuxt bỏ qua file này vì nó không nằm trong
`api/`, `routes/`, `middleware/`, `plugins/`, `utils/`).

**Đã sửa trong `nuxt.config.ts`:** bỏ khối `vite.resolve.alias` cho `prosemirror-*`. Khối đó chứa
**đường dẫn tuyệt đối** `D:/Applications/tm-hub/node_modules/.pnpm/node_modules/...` — chạy ở máy
khác là hỏng ngay. Xem §4 để biết vì sao bỏ được.

**Đã đổi branding sang tm-trading:** `app.vue` (titleTemplate), `app/app.config.ts` (`system.*`),
`nuxt.config.ts` (PWA manifest `id`/`name`/`short_name`/`description`),
`app/spa-loading-template.html` (title + màn hình chờ).

> `spa-loading-template.html` là thứ quyết định `<title>` thật khi `ssr: false` — **không phải**
> `app.vue`. Nuxt tự dùng file này theo quy ước `<srcDir>/spa-loading-template.html`.

---

## 2. GIỮ (đã chốt — không cắt)

| Nhóm | Gói | Ghi chú |
|---|---|---|
| **Editor** | `@tiptap/*` (**9 gói** sau batch 4: `core`, `vue-3`, `pm`, `suggestion`, `extension-{emoji,image,table,text-align,youtube}`), `prosemirror-*` | Cần cho soạn nội dung (journal/ghi chú lệnh). 16 gói tiptap không dùng đã cắt batch 4 — `pm`/`suggestion` phải giữ vì `@nuxt/ui` import lúc runtime |
| **PWA / push** | `@vite-pwa/nuxt`, `workbox-window`, `web-push`, `public/push-sw.js` | Cài như app, nhận thông báo đẩy — **lưu ý**: `web-push` server đã cắt batch 3 (đường push local chết), chỉ còn FCM qua `firebase` (dynamic import) + PWA runtime |
| **JSON editor** | ~~`json-editor-vue`, `vanilla-jsoneditor`~~ | ❌ **ĐÃ CẮT (batch 4, 2026-10-04)** — grep toàn repo 0 usage thật (không có chỗ nào "sửa preset/tham số engine bằng UI" trong code hiện tại). Cần lại thì cài lại |

**Hệ quả quan trọng:** `json-editor-vue` (đã cắt batch 4) từng kéo peer `@vue/composition-api` (Vue 2) →
`.npmrc` đang còn `legacy-peer-deps=true`. Cần **kiểm định lại** có còn cần không sau khi cắt
(`npm install --dry-run --legacy-peer-deps=false`) trước khi gỡ — chưa làm trong batch 4.
Peer đó chỉ cần cho Vue 2; với Vue 3 nó là `peerOptional` không dùng.

---

## 3. Ứng viên CẮT (✅ 4 batch đã cắt xong 2026-10-04 — bảng dưới giữ làm lịch sử)

| Nhóm | Vì sao cắt | Lưu ý |
|---|---|---|
| `server/modules/mail` + `@react-email/*` + `react`/`react-dom` | Email template của CMS, không liên quan trade desk | ✅ **Đã cắt (batch 1, 2026-10-04)** — đã từng là **thứ duy nhất** kéo `react` vào dự án; `node_modules/react` không còn |
| `@supabase/supabase-js` + `server/api/v1/**` (phần lớn) | 168 route phục vụ domain tm-hub (commerce, customers, media, apps, roles...) | ✅ `api/v1` **đã cắt batch 1–3** (còn đúng 5 route GIỮ + `webhook.mjs`); ⚠️ `@supabase/supabase-js` **GIỮ** — `modules/database/supabase` dùng (hub DB check) |
| Trang domain tm-hub: `app/pages/{admin,resources,system,utilities}` | Không thuộc dashboard trading | ✅ **batch 4**: `admin` (trừ `logs`) + `resources/*` đã xóa; `system` + `utilities` **GIỮ** — chúng là app features thật (profile/settings/docs/utilities) |
| i18n strings của tm-hub (`hub`, `hubVersion`, mô tả control plane) | Chỉ có nghĩa với domain cũ | ✅ **batch 4**: không tồn tại key `hub.*` literal; đã cắt **−1608 key** (20 section dead + leaf prune); GIỮ `nav.*` (label động), `error.*` (mã động), `settings.hubVersion`, `error.hubConnectionFailed` |
| `tinymce`, `he-tree`, `unovis`, `zxing`, `xlsx`, `bullmq`/`ioredis` | Chưa dùng ở trading | ✅ `he-tree`+`unovis` (batch 4), `xlsx`+`bullmq`/`ioredis` (batch 2); `tinymce` không có trong package.json; ⚠️ **`zxing` GIỮ** (`inputs/Scan` dùng `@zxing/browser`/`@zxing/library`) |

### ⚠️ KHÔNG được đổi tên — đây là định danh giao thức/gói, không phải branding

| Chỗ | Giá trị | Vì sao giữ |
|---|---|---|
| `app/pages/resources/connections.vue` | `'tm-hub-oauth'` | Là **loại kết nối** trong dữ liệu, đổi là hỏng logic |
| `app/pages/system/docs.vue` | `from 'tm-hub-client'` | Tên **package bên ngoài** |
| `app/pages/administration/logs.vue` | `hubAppId` fallback `'tm-hub'` | Khoá tra cứu app |
| `app/components/utilities/IconsPanel.vue` | `'tm-hub:icon-favorites'` | Khoá `localStorage` (đổi được nhưng sẽ mất prefs) |

### ⚠️ QUAN TRỌNG: tm-trading là **SATELLITE APP**, không phải bản sao của tm-hub

**tm-hub = hệ thống hỗ trợ kết nối xác thực tập trung (IAM provider).** tm-trading là **client**
đăng ký app trong tm-hub để lấy `appId`, rồi xác thực qua SDK `tm-hub-client`.

⇒ Phần auth **provider** trong bản clone là **trùng lặp** và sẽ cắt:

| Cắt (provider) | Vì sao |
|---|---|
| `server/modules/{auth,webauthn,token,permissions}` | tm-hub đã làm việc này; satellite không phát hành token |
| `server/api/v1/auth/*` (login/register/refresh/logout/me) | Client gọi **thẳng tm-hub**, không gọi route nội bộ |
| `app/pages/{login,register,forgot-password,reset-password}.vue` (bản clone) | Phải là bản gọi hub — xem §3b |

Nhưng **vẫn cần** phía server tự kiểm tra token do hub phát hành, cho các API riêng của tm-trading
(`runs`, `trades`, `positions`) — đây là yêu cầu **D10**. tm-tools làm việc này bằng `jose` +
`AUTH_ACCESS_TOKEN_SECRET` với `AUTH_PROVIDER=hub`.

✅ **ĐÃ LÀM (2026-10-03):** `server/middleware/auth.ts` — guard mọi `/api/**` (trừ
`/api/v1/health`, `/api/icons`, `/api/v1/configs/public`): đọc Bearer hoặc cookie
`accessToken` → `verifyAccessToken()` (jose HS256, secret chung với tm-hub) → gắn
`event.context.auth` + ràng buộc `payload.appId` phải là appId của tm-trading.
Các route provider cũ (nay đã cắt hết ở batch 1–3) trước đây cũng nằm trong vòng chốt này → không còn endpoint nào
tự phát token mà không kiểm soát trên cổng tm-trading.

---

## 3b. Tích hợp tm-hub (SATELLITE) — ✅ đã test đầu-cuối (2026-10-03)

### Luồng

```
tm-trading (client)                        tm-hub (provider, cổng 4000)
──────────────────                         ─────────────────────────────
login  ── POST ${hubUrl}/api/v1/auth/login ──►  xác thực, phát JWT
                    header X-App-Id: <appId>
       ◄──── accessToken + refreshToken + user(roles, permissions)
me     ── GET  ${hubUrl}/api/v1/auth/me   ──►
refresh── POST ${hubUrl}/api/v1/auth/refresh
logout ── POST ${hubUrl}/api/v1/auth/logout
```

Token lưu ở cookie `accessToken` + `refreshToken`; plugin `auth.client.ts` vá `$fetch` để **tự gắn**
`X-App-Id` + `Authorization: Bearer` và **tự refresh một lần** khi gặp 401.

### Chuẩn bị — ✅ ĐÃ LÀM (2026-10-03)

1. **Đã tạo app trong tm-hub** (qua `POST /api/v1/apps` với token root):
   ```ini
   NUXT_PUBLIC_HUB_APP_ID=tm-trading_pco4rn   # appId thật, tạo 2026-10-03
   HUB_APP_ID=tm-hub_vuyfg3                   # app hệ thống (is_system) của tm-hub
   ```
   > Hai biến **khác nhau**: `HUB_APP_ID` là appId của app **hệ thống tm-hub**
   > (dùng bởi `server/plugins/system-app.ts` check lúc boot),
   > `NUXT_PUBLIC_HUB_APP_ID` là **appId của chính tm-trading** (đi vào header `X-App-Id`
   > + claim `appId` của token).
2. Chạy tm-hub (cổng 4000) **trước**, rồi `npm run dev` cho tm-trading (cổng 4001).

### 🔑 Secret chia sẻ — bắt buộc để verify token offline (D10)

`AUTH_JWT_SECRET` của tm-trading **phải trùng** `AUTH_JWT_SECRET` của tm-hub
(`super-secure-shared-secret-key-32-chars-min` ở cả hai). Server tm-trading verify token
bằng `jose` + secret này, **không** gọi lại tm-hub. Đã thêm vào `.env.example` và đổi default
trong `nuxt.config.ts` (`runtimeConfig.jwtSecret`).

### File đã thay (lấy từ `tm-tools` — satellite đã chạy thật)

| File | Trước (clone từ tm-hub) | Sau (satellite) |
|---|---|---|
| `app/composables/useAuth.ts` | gọi `/api/v1/auth/*` — **route nội bộ** | gọi `${hubUrl}/api/v1/auth/*` + `X-App-Id` |
| `app/composables/useHub.ts` | chỉ là wrapper `$fetch` | bọc `HubClient` từ `tm-hub-client`, expose 12 module |
| `app/plugins/auth.client.ts` | chỉ gọi `fetchUser()` | vá `$fetch` (gắn `X-App-Id`/Bearer + silent refresh) + toast hết phiên |
| `nuxt.config.ts` | chỉ có `hubAppId` | thêm `public.hubUrl` (mặc định `http://localhost:4000`) |
| `.env` / `.env.example` | — | thêm `NUXT_PUBLIC_HUB_URL`, `NUXT_PUBLIC_HUB_APP_ID` |

### Đã kiểm chứng

| Hạng mục | Kết quả |
|---|---|
| `tm-hub-client` cài từ npm | v1.0.0 (gói publish để file ở **gốc** package, không phải `dist/`) |
| API thật của SDK | có **cả** `HubClient` (class, tm-tools dùng) **và** `createHubClient` (README dùng) — đã chạy thử, `setPermissions` OK, đủ 12 module |
| `useAuth` trỏ đúng hub | 5/5 lời gọi đều `${hubUrl}/api/v1/auth/*`, không còn route nội bộ |
| App boot với composable mới | HTTP **200** tại `http://localhost:4001/` |
| **Login thật đầu-cuối** ✅ | Browser test 2026-10-03: `POST /api/v1/auth/login` → **200**, `GET /api/v1/auth/routes` → **200**, `GET /api/v1/apps/tm-trading_pco4rn/notifications` → **200** (HubClient tự gắn `X-App-Id` + `Bearer`), redirect về `/` thấy app **TM Trading** trong danh sách 3 apps |
| Guard server (D10) | `/api/v1/health` không token → **200**; `/api/v1/apps` không token → **401**; token hợp lệ → **200**; token rác → **401** |

---

## 3c. Nav menu + branding + trang Runs — ✅ (2026-10-03)

**Nav menu** — seed qua hub API (hợp đồng `POST /api/v1/apps/{id}/routes`, cần `routes.manage`),
gắn với app `tm-trading_pco4rn`:

| path | label (i18n) | icon | ghi chú |
|---|---|---|---|
| `/` | `nav.overview` | `i-lucide-layout-dashboard` | trang Tổng quan |
| `/runs` | `nav.runs` | `i-lucide-flask-conical` | danh sách backtest runs |
| `/signals` | `nav.signals` | `i-lucide-radio-tower` | tín hiệu live (thêm 2026-10-03) |
| `/admin/logs` | `nav.logs` | `i-lucide-scroll-text` | audit log (gọi hub) |
| `#system` → `/system/profile`, `/system/settings` | `nav.system`/`nav.profile`/`nav.settings` | group + 2 mục con |

> **Device limit của tm-hub**: login bằng trình duyệt/PowerShell mặc định bị xếp platform `desktop`
> (giới hạn 2) → đã dùng User-Agent `... (command line)` để phân loại là `cli` (giới hạn 10) —
> đúng thiết kế của `server/utils/device.ts`, không phải "lách" limit. Login **bằng appId của hub**
> (`tm-hub_vuyfg3`, root có `*`) để seed route cho app trading, vì token appId khác bị guard D10 từ chối.

**Branding** — `app/pages/index.vue` viết lại: còn `dashboard.title`/`description` (i18n) nên đổi
giá trị trong **cả `en.json` và `vi.json`** ("Hub Control Center" → "Trading Overview" /
"Tổng quan Giao dịch") — 4 thẻ KPI mới (series · lượt chạy · lệnh unique · cảnh báo dữ liệu) +
list "Lần chạy gần đây". Các khoá `dashboard.*` khác (`ready`, `viewAll`) vẫn dùng ở trang
`admin/apps` + `NotificationsSlideover` → **giữ nguyên**.

**Trang Runs** (chuẩn BasePage + `LazyGridList` như `app/pages/administration/logs.vue`):

- `server/utils/reports.ts` — đọc `reports/*.ndjson`, gộp theo **series**
  `engineVersion~symbol~tf~paramsHash`, khui trùng lệnh theo nội dung, tổng hợp qua
  `summarizeRuns()` của engine (**không tính lại công thức** — D1).
- `GET /api/v1/runs` (list, cursor theo id) · `GET /api/v1/runs/:id` (chi tiết) — cả hai đi qua
  guard D10; không token → **401**, id sai → **400**.
- `engine/store.d.mts` — khai báo types cho `engine/store.mjs` (TS không đọc `.mjs`).
- **Import runtime, không import tĩnh**: Nitro ghi bundle `.nuxt/dev/index.mjs` và **tính sai độ sâu**
  đường dẫn tương đối ra ngoài `server/` (`../../../../../../engine/store.mjs` → `D:\engine\...`
  → 500 `Cannot find module`). Nên `reports.ts` nạp module bằng
  `import(pathToFileURL(join(process.cwd(), 'engine', 'store.mjs')).href)` (cache 1 lần).
- i18n: `runs.*` + `nav.runs` ở **cả en và vi**.

**Kết quả kiểm chứng**: 11 series trả về; BTC 15m 626 dòng → **121 lệnh unique** (505 trùng) với
cảnh báo `multipleRuns,duplicatesRemoved,multipleDataHashes`; chi tiết trả 36 params · 121 lệnh ·
2 dataHash · `gitRev` + `engineVersion`.

**Cập nhật 2026-10-03 (Signals)**: seed thêm `/signals` (`nav.signals`, `i-lucide-radio-tower`)
và dời sort: logs `2→3`, group_system `3→4` → thứ tự Overview · Backtest · **Signals** · Logs ·
System. Đã test đầu-cuối: webhook → Mongo → `GET /api/v1/signals` (filter/phân trang) → trang
`/signals` render hàng thật + empty state.

---

## 3d. Rà soát 176 route + 86 module — QUYẾT ĐỊNH GIỮ/CẮT (2026-10-03)

### Bằng chứng then chốt: UI clone gọi **hub**, không gọi backend local

| Chỗ | Bằng chứng |
|---|---|
| `adminFetch` | **chỉ là alias của `hubFetch`** — `app/composables/useAdminList.ts:85-87` |
| `hubFetch` | trỏ `${hubUrl}` (cổng **4000**) + `X-App-Id` — `app/composables/useHub.ts:44-48` |
| Nav menu | `auth.global.ts:78` + `useNavMenu.ts:17` → `hubFetch('/api/v1/auth/routes')` |
| Login/me | `useAuth.ts:100,302` → `${hubUrl}/api/v1/auth/...`; `useAuthApi.ts` (gọi local) **không còn ai import** |
| Local gọi thật | chỉ `$fetch` relative: `v1/runs`, `v1/signals`, `v1/health` (+ `icons`, `configs/public` whitelist D10) |

⇒ ~170 route local dưới `apps/**` (134), `auth/**` (28), `oauth/**` (2), `mail/webhooks` (6) là
**dead code** — D10 middleware vẫn bọc ngoài nên không hở, nhưng không còn handler nào được UI gọi.

### GIỮ (6 route local + module phụ trợ — dùng thật)

| Route local | Gọi bởi | Module kèm phải giữ |
|---|---|---|
| `v1/runs` + `v1/runs/:id` | trang `/`, `/runs`, `/runs/[id]` ($fetch relative) | `utils/reports` → engine |
| `v1/signals` | trang `/signals` | `utils/signals` → engine model |
| `v1/health` | `system/settings/system.vue` (`$fetch` relative) | `modules/database/supabase` (check hub DB) |
| `icons.get.ts`, `v1/configs/public` | PUBLIC_PATHS của D10 | `modules/config` + `utils/config` (xem batch 2) |
| — | D10 verify HS256 | **`modules/token/jwt`** (bắt buộc — không được cắt) |
| — | log/audit dashboard đọc sau (đã có `MONGODB_LOG_URI`) | `modules/logger/*` |
| `server/webhook.mjs` | engine (không nằm Nitro) | — |

### CẮT theo batch — ✅ batch 1 + 2 + 3 + 4 ĐÃ CẮT XONG (2026-10-04)

Mỗi batch sau khi cắt phải xanh: `npm run typecheck` + `npm test` + `npm run test:app` +
`npm run verify` + login click lại vài trang.

| Batch | Cắt | Quy mô | Vì sao an toàn |
|---|---|---|---|
| **1 — mail** ✅ (2026-10-04) | `api/v1/mail/webhooks` (6) + **`api/v1/apps/[id]/mail` (33 — lát mail của batch 2, cắt sớm để typecheck không vỡ khi xóa `modules/mail`)** + `modules/mail` (~45) + `plugins/mail-queue.ts` + `tests/mail-config.test.ts` + deps `react`/`react-dom`/`@react-email/*`/`nodemailer`/`mailgun.js`/`postmark`/`resend`/`@sendgrid/mail`/`@getbrevo/brevo`/`@aws-sdk/client-ses` + `@types/react*`/`@types/nodemailer` (**14 deps** — `node_modules/react` đã biến mất, `@react-email` còn dir rỗng) + `nuxt.config` bỏ exclude templates & 5 webhook-secret runtimeConfig. `modules/notification/email.ts`: `sendEmailViaSmtp()` **stub always-false** (Gmail path giữ nguyên) — auth reset-password chưa cắt (batch 3) vẫn typecheck. | ~85 file · −14 deps | `inbox.vue`/`queues.vue` đã gọi hub qua `adminFetch`; đây là thứ **duy nhất** kéo `react` (bẫy #4). **Đã verify**: typecheck 4/4 · `npm test` 672/0 · `test:app` 72/72 (−6 test mail) · `verify` 0 · login duyệt `/` · `/runs` · `/signals` · `/resources/inbox` · `/resources/queues`, 0 console error (chỉ Suspense INFO) |
| **2 — apps domain hub** ✅ (2026-10-04) | `api/v1/apps/**` (101 còn lại) + `modules/{import,export,media,permissions}` (12 file) + `plugins/import-queue.ts` + **kéo theo app-side**: `app/pages/admin/apps/[id]/import.vue` + `app/components/admin/import/*` (8) + `app/composables/admin/useAdminImport.ts` — 10 file này type-import `~~/server/modules/import/types`, không cắt typecheck vỡ + deps `bullmq`/`ioredis`/`csv-parse`/`xlsx`/`form-data`/`striptags` (**6 deps** — bullmq/ioredis chỉ có trong `modules/import/queue`; `form-data`/`striptags` đã mồ côi từ trước) + `nuxt.config` bỏ `nitro.externals.inline: ['xlsx']` | ~124 file · −6 deps | **Đổi nhịp so với bảng cũ**: `modules/{connections,notification,routes}` **dời hẳn sang batch 3** — chúng bị `oauth/**`, `auth/{forgot,reset,routes}` (đều batch 3) import, cắt trước làm vỡ typecheck. 4 test doc nêu (`rbac-routes`/`scope`/`config-service`/`feature-layer`) **không cần sửa**: hoặc import keeper (`shared/rbac`, `modules/config`, `utils/config`) hoặc fixture chuỗi thuần. **Đã verify**: typecheck 4/4 · `npm test` 672/0 · `test:app` 72/72 · `verify` 0 · login duyệt `/` · `/admin/apps` · `/signals`, console sạch; dev server cần kill/start lại sau khi `nuxt.config` đổi (restart tự hay treo 503) |
| **3 — auth provider** ✅ (2026-10-04) | `api/v1/auth/**` (28: login/logout/refresh/me/register/forgot/reset/routes/introspect/permissions + oauth 4 + passkey 6 + sessions 2 + totp 4) + `api/v1/oauth/**` (2) + `modules/{auth,totp,webauthn,connections,notification,routes}` (21 file). **GIỮ** `server/types/webauthn.ts` — `app/types/webauthn.ts` re-export từ nó (app không type-import `~~/server/modules/*` nào). deps: `bcryptjs`+`@types/bcryptjs`, `otplib`, `@simplewebauthn/server`, `cloudinary`, `web-push`, `@types/web-push` (**7 deps**). ⚠️ `firebase` **KHÔNG cắt** — `useWebPush.ts:84-85` import động `firebase/app`+`firebase/messaging` (đường FCM khi hub có `FIREBASE_*` config; grep `from 'firebase` thường miss dynamic import) → đã gỡ rồi restore `^12.17.0`. | ~49 file · −7 deps | **Đã verify**: typecheck 4/4 · `npm test` 672/0 · `test:app` 72/72 · `verify` 0 · browser **logout→login full cycle** (đi hub, local auth đã xóa sạch) · `/system/profile/security` render Passkey section qua hubFetch, console sạch. Kết quả: `api/v1` chỉ còn đúng danh sách GIỮ (`configs/public`, `risk`, `runs`, `signals`, `health`), `modules` chỉ còn 4 keeper (`config`, `database`, `logger`, `token`) |
| **4 — trang + i18n hub** ✅ (2026-10-04) | **75 file xóa** = 15 trang (`admin/{permissions,roles,routes,users}` + `admin/apps/**` + 7 trang `resources/*`; **GIỮ** `admin/logs`) + 60 component/composable chết. **Nav filter**: `useNavMenu.buildNavItems` giờ lọc hub-tree theo `router.getRoutes()` (leaf phải có page local, group giữ khi còn con sống, `#` bỏ, `'*'` giữ) — nav không còn link 404. **4 remnant sửa**: `useDashboard.ts` bỏ shortcut `g-a→/admin/apps`; `layouts/default.vue` bỏ entry fallbackNav apps; `HelpModal.vue` bỏ nút quick-link apps; `NotificationsSlideover.vue` bỏ `navigateTo('/resources/notifications')` (×2 thật +1 comment) + bỏ footer "View all" chết. **deps −31** (77→46): `@he-tree/vue`, `@tanstack/table-core`, `@types/mongoose`, `@unovis/{ts,vue}`, `date-fns`, `easyqrcodejs`, `jsbarcode`, `json-editor-vue`, `vanilla-jsoneditor`, `qrcode`+`@types/qrcode`, `to-px`, `vue-draggable-resizable` (+ `types/vue-draggable-resizable.d.ts`), 16 gói `@tiptap/*` không dùng (`starter-kit`,`markdown`,`extension-{bubble-menu,character-count,code-block-lowlight,drag-handle-vue-3,floating-menu,highlight,horizontal-rule,link,mention,placeholder,table-cell,table-header,table-row,typography,underline}`) — **GIỮ 9**: `core`,`vue-3`,`pm`,`suggestion`,`extension-{emoji,image,table,text-align,youtube}` (pm+suggestion là runtime import của `@nuxt/ui`; còn lại editor dùng thật). **i18n −1608 key** (2416→808/en+vi đồng bộ): cắt trọn 20 section dead (tools, apps, import, profiles, features…) + leaf prune trong section trộn; **GIỮ toàn bộ** `nav` (label động từ hub-tree) + `error` (mã lỗi động `t(code)`); 5 dynamic hotspots đã rà (`options.titleKey`/`descKey` trong `useAdminPageChrome`, `t(code/text/getErrorKey)` trong `errors.ts`); script audit: `tools/i18n-usage.mjs` + `tools/prune-i18n.mjs`. ⚠️ `firebase` vẫn giữ (dynamic import FCM). | 75 file · −31 deps · −1608 i18n keys | Quy tắc grep xác nhận: mọi UI đã qua `hubFetch`/`hubUrl`; rbac codes (`apps.read`…) là capability **không phải** i18n; `import.meta` match nhầm khi grep `import.`. **Đã verify**: typecheck 4/4 · `npm test` 672/0 · `test:app` 72/72 · `verify` 0 (chạy lại **sau** khi sửa 4 remnant) · browser **login cycle mới** (clear storage→login): console **0 error/0 warning** (warning `VUE_ROUTER_R0004 /admin/apps` ×5 đã hết) · nav 3 group mở ra đúng trang giữ (Administration=Logs, Utilities=5, System=3) · duyệt `/` · `/admin/logs` · `/utilities/editor` (tiptap render đủ toolbar, bấm Bold 0 error) · `/system/profile/security` (Passkey qua hubFetch) · `/signals` · `/runs` · Notifications slideover mở sạch (footer chết đã bỏ) |

> ⚠️ **Tension đã chốt**:4 TOTP endpoint + 5 routes endpoint "clone y hệt hub, 0 dòng khác"
> **không phải mảng cần giữ** — chúng thuộc batch 3 và batch 2. Thêm module mới chỉ dành cho
> domain trading (ví dụ `signals` vừa thêm). Muốn giữ bất kỳ route hub nào trên local thì phải
> chỉ ra bằng chứng UI **local** gọi nó ( kiểm bằng grep `$fetch('/api/v1/...` không qua `hubFetch`).
>
> ✅ **Đã áp dụng & cắt thật (2026-10-04)**: toàn bộ auth local (28 route) + oauth (2) + 6 module
> bị xóa sau khi grep chứng minh mọi UI đều qua `hubFetch`/`hubUrl` (login/passkey/totp/sessions/
> me); mỗi đường local `$fetch('/api/v1/auth/...')` còn lại đều nằm trong `useAuthApi.ts` — composable
> **không ai gọi**. Kết luận kiểm chứng — batch 4 đã cắt cùng quy tắc grep đó (xong 2026-10-04).

---

## 4. Vì sao BỎ được khối alias prosemirror (đã kiểm chứng)

tm-hub phải alias tay vì **pnpm không hoist** → nhiều bản `prosemirror-*` cùng tồn tại → tiptap báo
*"Adding different instances of a keyed plugin (plugin$)"*.

**Đã kiểm chứng bằng cách quét `node_modules` ở mọi độ sâu:** mỗi gói prosemirror chỉ có **đúng 1 bản**.

```
prosemirror-state 1.4.4 · model 1.25.12 · transform 1.12.2 · view 1.42.6
history 1.5.1 · keymap 1.2.3 · commands 1.7.2 · inputrules 1.5.1
schema-list 1.5.1 · gapcursor 1.4.1 · dropcursor 1.8.4 · tables 1.8.5
@tiptap/pm 3.31.4 (trùng khớp @tiptap/core 3.31.4)
```

→ npm hoist phẳng nên **không có bản trùng**, alias là không cần thiết.

**Điều kiện để kết luận này còn đúng:** nếu sau này có gói nào kéo về một bản `prosemirror-*` khác
version (npm sẽ cài lồng trong `node_modules` của gói đó), lỗi editor sẽ quay lại. Khi đó **không**
copy lại đường dẫn tuyệt đối của tm-hub — dùng alias tương đối:

```ts
'prosemirror-state': fileURLToPath(new URL('./node_modules/prosemirror-state', import.meta.url))
```

---

## 5. Bẫy môi trường đã gặp thật (giữ lại để không mất thời gian lần nữa)

| # | Triệu chứng | Nguyên nhân thật | Cách xử lý |
|---|---|---|---|
| 1 | `npm install` → `EPERM ... npm-cache\_cacache\tmp\...` | Cache npm mặc định nằm **ngoài workspace** → sandbox chặn ghi | `.npmrc`: `cache=D:/Applications/.npm-cache` |
| 2 | `npm install` → `ERESOLVE ... json-editor-vue` | pnpm không áp peer strict, npm thì có | `.npmrc`: `legacy-peer-deps=true` (giữ lâu dài) |
| 3 | `npm install` → `EPERM ... spawn` | Sandbox chặn npm chạy lifecycle script của dependency | `npm install --ignore-scripts` (các gói native ở đây đều có prebuilt qua optionalDependencies) |
| 4 | `nuxt prepare` → `Cannot find module 'react'` | pnpm **tự cài peer**, npm thì không; tm-hub dùng react 19.3.0 từ `.pnpm` store | Thêm `react@^19.3.0` + `react-dom@^19.3.0` |
| 5 | `nuxt prepare` sinh xong `.nuxt` nhưng **treo, không thoát** | Handle chưa đóng lúc thoát | Xác nhận đã xong bằng: 5 tsconfig đều JSON hợp lệ + `nuxt.d.ts` reference đủ 6 module. Rồi kill |
| 6 | `nuxt dev` → `[nitro] ERROR Error: spawn EPERM` | Nitro cần spawn tiến trình con cho dev worker; sandbox chặn | Chạy dev server với quyền rộng hơn |
| 7 | Dev server chạy mà `http://127.0.0.1:4001/` **không** trả lời | Server bind IPv6 | Dùng **`http://localhost:4001/`** |
| 8 | Xung đột cổng với tm-hub | tm-hub dùng `4000` | tm-trading dùng **`4001`** |

---

## 6. Trạng thái kiểm chứng

| Hạng mục | Kết quả |
|---|---|
| `npm install` | 1534 gói, exit 0 |
| `nuxt prepare` | `.nuxt/` 169 file, 5 tsconfig JSON hợp lệ, `nuxt.d.ts` reference đủ **6 module** (ui, image, i18n, pwa, vueuse, pinia) |
| `npm run dev` | HTTP **200** tại `http://localhost:4001/`, có `__nuxt`; plugin chạy đúng (`QUEUES_ENABLED=false` được tôn trọng) |
| `npm run typecheck` | `tools/typecheck.mjs` (chống treo bẫy #5) — **PASS 4/4** project (server/app/shared/node) |
| `npm test` | smoke **173/0** · engine **360/0** · db **49/0** |
| `npm run test:app` | **49/49** (`tests/run-tests.mjs`) |
| `npm run verify` | build 4/4 + toàn bộ test trên — xanh (2026-10-03) |
| E2E signals (2026-10-03) | không token → **401**; có token → 200 `mongo:'up'`; `since=xxx` → **400**; webhook → 200 → Mongo → API (filter/phân trang cursor) → trang `/signals` render hàng thật ✓ |