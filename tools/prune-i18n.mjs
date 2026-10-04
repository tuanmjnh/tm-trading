import fs from "node:fs"
import path from "node:path"

function walk(d, out = []) {
  if (!fs.existsSync(d)) return out
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) {
      if (["node_modules", ".nuxt", ".output", "dist"].includes(e.name)) continue
      walk(p, out)
    } else if (/\.(vue|ts)$/.test(e.name)) out.push(p)
  }
  return out
}

const files = [...walk("app"), ...walk("shared"), ...walk("server")]
const srcs = files.map(f => fs.readFileSync(f, "utf8"))

const used = new Set()
const dynPrefixes = []

for (const s of srcs) {
  let m
  let re = /\bt\(\s*['"`]([A-Za-z0-9_.-]+)['"`]/g
  while ((m = re.exec(s))) used.add(m[1])
  re = /\bt\(\s*`([A-Za-z0-9_.-]+)\$\{/g
  while ((m = re.exec(s))) dynPrefixes.push(m[1])
  // string literal dang i18n key (titleKey: 'admin.logs.title', error codes...)
  re = /['"`]([a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9_]+)+)['"`]/g
  while ((m = re.exec(s))) used.add(m[1])
}

const usedPrefix = [...used].filter(k => k.endsWith("."))
function isUsed(key) {
  if (used.has(key)) return true
  if (usedPrefix.some(p => key.startsWith(p))) return true
  if (dynPrefixes.some(p => key === p || key.startsWith(p))) return true
  return false
}

// Cat toan bo20 section khong ai dung (da verify khong co usage i18n)
const WHOLE = ["appUpdate", "apps", "chat", "configs", "connections", "customers", "features", "feedback", "home", "icon_selector", "import", "inbox", "input_icon", "network", "products", "profiles", "routes", "seed", "tools", "queues"]
// Giu toan bo (dynamic: hub labels / error codes)
const KEEP_ALL = ["nav", "error"]

const en = JSON.parse(fs.readFileSync("i18n/locales/en.json", "utf8"))
const vi = JSON.parse(fs.readFileSync("i18n/locales/vi.json", "utf8"))

const removed = {}
let totalRemoved = 0

function prune(obj, prefix = "") {
  const out = {}
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? prefix + "." + k : k
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const child = prune(v, key)
      if (Object.keys(child).length === 0) {
        if (!prefix && WHOLE.includes(k)) { removed[k] = (removed[k] || 0) + 1; totalRemoved++ }
        continue
      }
      out[k] = child
    } else {
      if (!prefix && WHOLE.includes(k)) { removed[k] = (removed[k] || 0) + 1; totalRemoved++; continue }
      const top = key.split(".")[0]
      if (KEEP_ALL.includes(top) || WHOLE.includes(top)) { out[k] = v; continue }
      if (isUsed(key)) out[k] = v
      else { removed[top] = (removed[top] || 0) + 1; totalRemoved++ }
    }
  }
  return out
}

const prunedEn = {}
const topStats = []
for (const [k, v] of Object.entries(en)) {
  if (WHOLE.includes(k)) { topStats.push([k, "CAT HET (" + (typeof v === "object" ? Object.keys(v).length : 1) + ")"]); continue }
  if (KEEP_ALL.includes(k)) { prunedEn[k] = v; topStats.push([k, "Giu het"]); continue }
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const before = JSON.stringify(v).length
    const child = prune(v, k)
    if (Object.keys(child).length === 0) continue
    prunedEn[k] = child
    const after = JSON.stringify(child).length
    topStats.push([k, before === after ? "Giu het" : "cat mot phan (" + before + "->" + after + " bytes)"])
  } else {
    if (isUsed(k)) prunedEn[k] = v
    else { removed[k.split(".")[0]] = (removed[k.split(".")[0]] || 0) + 1; totalRemoved++ }
  }
}

// Prune vi theo cung key paths
const enPaths = new Set()
;(function collect(obj, prefix = "") {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? prefix + "." + k : k
    if (v && typeof v === "object" && !Array.isArray(v)) collect(v, key)
    else enPaths.add(key)
  }
})(prunedEn)

let viRemoved = 0
let viMissing = 0
function pruneVi(obj, prefix = "") {
  const out = {}
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? prefix + "." + k : k
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const child = pruneVi(v, key)
      if (Object.keys(child).length === 0) continue
      out[k] = child
    } else {
      if (enPaths.has(key)) out[k] = v
      else viRemoved++
    }
  }
  return out
}
const prunedVi = pruneVi(vi)

// kiem tra vi con thieu key nao khong
;(function checkVi(obj, prefix = "") {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? prefix + "." + k : k
    if (v && typeof v === "object" && !Array.isArray(v)) checkVi(v, key)
    else if (!prunedVi || !viHasKey(prunedVi, key)) viMissing++
  }
})(prunedEn, "")
function viHasKey(obj, key) {
  const parts = key.split(".")
  let cur = obj
  for (const p of parts) { if (!cur || typeof cur !== "object" || !(p in cur)) return false; cur = cur[p] }
  return true
}

fs.writeFileSync("i18n/locales/en.json", JSON.stringify(prunedEn, null, 2) + "\n")
fs.writeFileSync("i18n/locales/vi.json", JSON.stringify(prunedVi, null, 2) + "\n")

console.log("=== EN ===")
for (const [sec, note] of topStats) console.log("  " + sec.padEnd(16) + " " + note)
console.log("Tong key da xoa (en):", totalRemoved)
console.log("Vi: xoa", viRemoved, "| vi thieu so voi en:", viMissing)
