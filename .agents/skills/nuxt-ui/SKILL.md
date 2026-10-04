---
name: nuxt-ui
description: Build UI in this project with Nuxt UI v4 (@nuxt/ui 4.x, Tailwind CSS v4, Vue 3, Nuxt 4). Use when creating or editing .vue pages/components, styling U* components, using the ui prop, theming via defineAppConfig, or customizing UModal/UCard/UInput/UButton/UFormField/UForm/USelect/UTextarea etc. Covers the v4 API: slots, variants, compoundVariants, defaultVariants, semantic colors, --ui-* CSS variables, and common mistakes like :ui="{ width }" which no longer work.
---

# Nuxt UI v4 — Project UI Guide

## Stack
- `@nuxt/ui` **4.x** + Tailwind CSS **v4** + Vue 3 + Nuxt 4 (project: `D:\Applications\electron-nuxt-app`)
- CSS-first config in `app/assets/css/main.css` via `@import "@nuxt/ui"` and `@theme static { ... }`
- Nuxt UI v4 uses **Tailwind Variants (TV)**: every component theme = `slots`, `variants`, `compoundVariants`, `defaultVariants`
- Icon set: `@iconify-json/lucide` → `i-lucide-*`

## Theming model (CRITICAL)
A component's theme object:

```ts
{ slots: {...}, variants: {...}, compoundVariants: [...], defaultVariants: {...} }
```

- `slots` = distinct HTML parts (e.g. `root`, `base`, `content`, `header`, `body`, `footer`, `label`, `leadingIcon`, `trailingIcon`, `overlay`, `title`, `description`, `close`)
- `variants` = class changes per prop value (e.g. `color`, `variant`, `size`, `fullscreen`)
- `compoundVariants` = classes when multiple variants combine
- `defaultVariants` = default prop values

### Global theming → `app.config.ts` (project currently has NO app.config.ts)
```ts
export default defineAppConfig({
  ui: {
    card: { slots: { root: 'rounded-xl' } },
    button: {
      variants: { size: { sm: { base: 'px-2.5 py-1' } } },
      compoundVariants: [{ color: 'error', variant: 'outline', class: 'ring ring-inset ring-error/50' }],
      defaultVariants: { variant: 'solid' }
    }
  }
})
```
Add `app/app.config.ts` if you need global overrides.

### Per-instance `ui` prop
- `:ui="{ <slotName>: 'class' }"` — **only valid slot keys for that component are allowed**. TypeScript enforces this (project has `typescript.typeCheck: true`).
- **NOT arbitrary**: `:ui="{ width: 'max-w-md' }"` on `UModal`, `:ui="{ divide: '...' }"` on `UCard` → **TS errors** (no such slot). Never invent keys.

### `class` prop
- Overrides the `root`/`base` slot only. Use for one-off layout tweaks: `class="w-full lg:max-w-md"`.

## Component API notes (v4)

### UModal
- `default` slot = **trigger button**. `#content` = whole panel, `#header`/`#body`/`#footer` = sections, `#title`/`#description`/`#actions`/`#close` available.
- Props: `title`, `description`, `close`, `overlay`, `modal`, `dismissible`, `transition`, `scrollable`, `fullscreen`, `portal`, `unmount-on-hide`, `open` / `v-model:open`, `default-open`.
- **Width is NOT `:ui="{ width }`** (invalid). Override the `fullscreen:false` variant content class: `:ui="{ content: 'w-[calc(100vw-2rem)] max-w-lg ...' }"` or globally via `ui.modal.variants.fullscreen.false.content`.
- `#footer` slot receives `{ close }` (`<template #footer="{ close }">`), call `close()` to dismiss.
- To open without a trigger, control `v-model:open` and leave default slot empty.

### UCard
- Slots: `root`, `header`, `title`, `description`, `body`, `footer`. No `divide` slot — use `:ui` only with the valid keys above or plain Tailwind classes on children.

### UButton
- `color`: `primary | secondary | success | info | warning | error | neutral`
- `variant`: `solid | soft | subtle | outline | ghost | link`
- **Default Variant Rule**: Khi thêm `UButton` nếu không có yêu cầu cụ thể nào khác, **BẮT BUỘC MẶC ĐỊNH SỬ DỤNG `variant="soft"`** (tránh để mặc định `solid` trừ khi có yêu cầu thiết kế riêng; nút Huỷ/Đóng/icon phụ dùng `variant="ghost"`, nút xoá hàng loạt phụ dùng `variant="subtle"` theo AGENTS.md).
- `size`: `xs | sm | md | lg | xl`
- `icon`/`trailing-icon`/`loading`/`block`/`square`/`loading-auto` supported.

### UFormField / UForm / UInput / USelect / USelectMenu / UTextarea / UCheckbox
- `UFormField` wraps with `name`, `label`, `description`, `hint`. Place the input inside as default slot.
- `UInput` `ui` slots include `base`, `leading`, `trailing`, `leadingIcon`, `trailingIcon`. Use `#leading`/`#trailing` templates for custom content.
- **USelect and USelectMenu in Nuxt UI v4**:
  - Both components use the **`items`** prop (NOT `options`) to pass selectable items. E.g., `:items="[{ label: 'Option 1', value: 1 }]"` or `:items="['opt1', 'opt2']"`.
  - Pass the **`value-key="value"`** prop (or camelCase `valueKey`) when binding objects so `v-model` binds to the ID/value string rather than the entire object.
  - Set localized placeholders on components: `:placeholder="t('...')"` (avoid hardcoding static strings).
  - **USelectMenu Search Input Convention**: `USelectMenu` bắt buộc phải thêm thuộc tính `:search-input="{ icon: 'i-lucide-search', placeholder: t('...') }"` (ví dụ: `:search-input="{ icon: 'i-lucide-search', placeholder: t('global.search') }"`) để luôn có icon tìm kiếm và hỗ trợ i18n đầy đủ.
  - To handle empty states in `USelectMenu` when no options are loaded, use the `#empty` slot (e.g., `<template #empty>{{ t('...') }}</template>`) or the `empty` prop.
- **Every `UForm` MUST validate with a zod `:schema`** — see the "Form convention — UForm + UFormField + zod" section below.

### UDashboardPanel / BasePage Layout Padding
- Standard pages using `<BasePage>` get the default theme's page padding.
- For layout wrappers with sub-navigation tabs (like `system.vue` or `settings.vue`), **always use the `<BasePage>` component** and render the sub-navigation tabs within the `<template #toolbar>` slot:
  ```html
  <BasePage id="system" :title="t('nav.system')">
    <template #toolbar>
      <UDashboardToolbar>
        <UNavigationMenu :items="links" highlight class="-mx-1 flex-1" />
      </UDashboardToolbar>
    </template>
    
    <!-- Centering container for form pages if needed -->
    <div class="flex flex-col gap-4 w-full lg:max-w-2xl mx-auto py-6">
      <NuxtPage />
    </div>
  </BasePage>
  ```
- In child pages rendered inside the nested `NuxtPage` (like `/system/config.vue` or `/system/seed.vue`), **do not wrap the template in `<BasePage>` or `<UDashboardPanel>`**. Simply render standard component elements (like `<UCard>`, `<UForm>`) directly, to avoid duplicate stacked headers and nested panel borders.

## Tailwind v4 syntax
- Arbitrary values: `w-[calc(100vw-2rem)]`, `max-w-md`, `size-4`, `grid place-items-center`.
- Dynamic color via CSS vars: `text-(--ui-error)`, `bg-(--ui-primary)`, `ring-(--ui-border)`.
- Semantic text utilities: `text-default`, `text-muted`, `text-dimmed`, `text-highlighted`, `text-inverted`, `bg-elevated`, `bg-accented`, `ring-default`, `divide-default`.
- Semantic colors (also valid `color` prop values): `primary`, `secondary`, `success`, `info`, `warning`, `error`, `neutral`.

## Common mistakes to avoid
- `:ui="{ width: ... }"`, `:ui="{ divide: ... }"`, or any non-slot key → TS error. Check the component's theme slots first (hover the `ui` prop or read the docs Theme section).
- Putting modal content in the default slot of `UModal` (it's the trigger). Use `#body`/`#content`.
- Using `@theme` without `static` for tokens that must exist at build time, or adding colors without all shades 50→950.
- Forgetting `npm run typecheck` after UI changes — it catches invalid `ui`/slot usage.

## Form convention — UForm + UFormField + zod (project standard)

Every real form in this project MUST validate with a **zod** schema wired into `UForm`. Copy this structure so all modules stay consistent.

### Pattern
```vue
<script setup lang="ts">
import { z } from 'zod'

const { t } = useI18n()

// Locale-reactive: use computed so validation messages update on language switch
const schema = computed(() => z.object({
  name: z.string().min(2, t('admin.nameMin')),
  email: z.string().min(1, t('auth.emailRequired')).email(t('auth.emailInvalid')),
  // Optional fields must explicitly allow empty/undefined
  bio: z.string().optional()
}))

const state = reactive({
  name: '',
  email: '',
  bio: ''
})

async function onSubmit() { /* $fetch ... */ }
</script>

<template>
  <UForm :schema="schema" :state="state" @submit="onSubmit">
    <UFormField :label="t('auth.name')" name="name">
      <UInput v-model="state.name" class="w-full" />
    </UFormField>
    <!-- name="email" must match the schema key for errors to attach -->
    <UFormField :label="t('auth.email')" name="email">
      <UInput v-model="state.email" type="email" class="w-full" />
    </UFormField>
    <UButton type="submit" :label="t('global.save')" />
  </UForm>
</template>
```

### Rules
- `import { z } from 'zod'` — zod is an existing dependency. Do NOT add valibot/yup.
- Define the schema in `<script setup>` as a **`computed(() => z.object({...}))`** when messages come from `t()` (recommended for locale switching). A plain `const schema = z.object(...)` is OK for static schemas (login/register).
- **Field names must match**: `UFormField name="..."` ↔ schema key. Errors render under the matching field; fields without a schema key show no error.
- Optional inputs: `z.string().optional()` (or `.refine(v => !v || cond, msg)` for "empty OR valid" cases, e.g. URL/port checks in `system/config.vue`).
- Conditional required (e.g. admin user password only when creating): build schema reactively — `editingUser.value ? z.string().optional() : z.string().min(6, t('auth.passwordMin'))`.
- All validation messages go through i18n keys (`i18n/locales/en.json` + `vi.json`). Reuse `auth.*` messages where possible (`auth.emailRequired`, `auth.emailInvalid`, `auth.nameMin`, `auth.passwordMin`, `admin.nameMin`, `admin.usernameRequired`, `admin.roleRequired`, `settings.invalidUrl`, `settings.invalidMongoUri`, `settings.invalidPort`).
- Submit button: `type="submit"` inside the `UForm`. If the button lives OUTSIDE the form, link it with `form="<id>"` attribute on the button AND `id="<id>"` on the UForm (see `system/config.vue`).
- Modals: UForm goes inside `#content` (or `#body`) of `UModal` — never in the default slot (that's the trigger).
- Grouping/sections: use `UCard variant="subtle"` with `#header` + body `div.flex.flex-col.gap-4` (see `system/config.vue`), or `UPageCard` for settings-style horizontal layouts.
- Do NOT use `UFormField required` alone to validate — `required` only renders the asterisk; validation must come from the zod schema.

### Form Interactions & Execution Controls
When integrating forms with background runner/processing tasks:
1. **Disable Form Inputs During Execution**: All form controls (`UInput`, `UTextarea`, `USelectMenu`, `UCheckbox`, etc.) and action buttons (like preset chips and select adders) must be disabled when a task is processing or active:
   ```html
   :disabled="isProcessing || isPaused"
   ```
2. **Auto-Fetch Metadata / Options**:
   - For single-input forms (e.g. loading configurations/formats directly from a URL), watch the target URL ref to auto-trigger the data fetch instead of requiring manual button triggers.
   - Implement debouncing (e.g., `800ms`) in the watcher using a `setTimeout` to avoid redundant spawns while typing.
   - Render a loading indicator inside the input using the native `:loading="fetching"` attribute.
3. **Execution Button Loading**:
   - The primary execution button should display a loading spinner when a task is running to give direct visual feedback. Set:
     ```html
     :loading="isProcessing && !isPaused"
     ```
4. **Highlighting Active Preset Chips**:
   - When listing quick configuration presets or selectors, highlight the currently active preset by dynamically changing its color and variant:
     ```html
     :variant="state.selectedId === item.id ? 'solid' : 'outline'"
     :color="state.selectedId === item.id ? 'primary' : 'neutral'"
     ```

## GridList & Cursor Pagination Standards

This project implements a hybrid List/Grid UI standard (`GridList` component) backed by cursor-based (infinite scroll) pagination to deliver high performance and consistency for data listings.

### 1. GridList Component Usage
Use `<LazyGridList>` when displaying arrays of items (e.g. Users, Customers).
- Avoid manual checkbox columns or action drop-downs; use the component's built-in `selectable` and `:action-options` props:
  ```vue
  <LazyGridList
    :items="items"
    :columns="columns"
    :loading="loading"
    v-model:selected="selected"
    item-key="id"
    selectable
    :can-load-more="canLoadMore"
    :action-options="getActionOptions"
    @load-more="onLoadMore"
    @refresh="fetchData(true)"
  >
    <template #columnKey="{ item }">
      <!-- Custom rendering for columns -->
    </template>
  </LazyGridList>
  ```
- Use `useAdminGridView(storageKey)` composable inside the page to synchronize user-selected view mode (List vs. Grid) via local storage.

### 2. Cursor Pagination Logic
- **Server API**:
  - Accept `cursor` and `limit` query parameters.
  - Return `{ success: true, data: [...], nextCursor: string | number | null }`.
  - The `nextCursor` should be the cursor value (e.g. `createdAt` ISO string, unique ID, or sequential index) of the last item in the returned slice if there is a next page, otherwise `null`.
- **Frontend Composable**:
  - Maintain states for `items`, `cursor`, `canLoadMore`, and `loading`.
  - Append new items to the existing array when loading more (filtering duplicates using a unique key).
  ```typescript
  const fetchItems = async (reset = false) => {
    if (loading.value) return
    if (!canLoadMore.value && !reset) return
    loading.value = true
    if (reset) {
      cursor.value = null
      items.value = []
      canLoadMore.value = true
    }
    const res = await $fetch('/api/items', { query: { cursor: cursor.value || undefined, limit: 10 } })
    if (res.success && res.data) {
      if (reset) items.value = res.data
      else {
        const ids = new Set(items.value.map(i => i.id))
        items.value = [...items.value, ...res.data.filter(i => !ids.has(i.id))]
      }
      cursor.value = res.nextCursor
      canLoadMore.value = !!res.nextCursor
    }
    loading.value = false
  }
  ```

## Workflow
1. Read the component's docs page (https://ui.nuxt.com/docs/components/<name>) → **Props / Slots / Theme** sections.
2. Choose: global theme (`app.config.ts`) for consistent overrides, `:ui` prop for one-off slot styling, `class` for root tweaks.
3. Only use slot keys listed in that component's Theme.
4. Run `npm run typecheck` to verify no invalid `ui` keys.
