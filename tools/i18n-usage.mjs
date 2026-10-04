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
const srcs = files.map(f => ({ f, s: fs.readFileSync(f, "utf8") }))

const keyRe = /\bt\(\s*['"`]([A-Za-z0-9_.-]+)['"`]/g
const dynRe = /\bt\(\s*`([A-Za-z0-9_.-]+)\$\{/g
const used = new Set()
const dynPrefix = new Set()
for (const { s } of srcs) {
  let m
  const kr = new RegExp(keyRe.source, "g")
  const dr = new RegExp(dynRe.source, "g")
  while ((m = kr.exec(s))) used.add(m[1])
  while ((m = dr.exec(s))) dynPrefix.add(m[1])
}

const en = JSON.parse(fs.readFileSync("i18n/locales/en.json", "utf8"))

function leafKeys(obj, prefix = "") {
  const out = []
  for (const k of Object.keys(obj)) {
    const v = obj[k]
    const key = prefix ? prefix + "." + k : k
    if (v && typeof v === "object" && !Array.isArray(v)) out.push(...leafKeys(v, key))
    else out.push(key)
  }
  return out
}

console.log("used literal keys:", used.size, "| dyn prefixes:", [...dynPrefix].join(" | "))

// t(arg) voi arg khong phai literal/template — diem nong dynamic key
const dynArgRe = /\bt\(\s*(?!['"`])([A-Za-z_$][\w.$]*)/g
const dynArgs = new Map()
for (const { f, s } of srcs) {
  let m
  const re = new RegExp(dynArgRe.source, "g")
  while ((m = re.exec(s))) {
    const arg = m[1]
    if (["true", "false", "null", "undefined", "key"].includes(arg)) continue
    const line = s.slice(0, m.index).split("\n").length
    if (!dynArgs.has(arg)) dynArgs.set(arg, [])
    dynArgs.get(arg).push(f.replace(/\\/g, "/") + ":" + line)
  }
}
console.log("dynamic t(arg) distinct:", dynArgs.size)
for (const [k, locs] of [...dynArgs.entries()].slice(0, 50)) {
  console.log("  t(" + k + ") x" + locs.length + "  " + locs[0])
}

console.log("")
for (const sec of Object.keys(en)) {
  const keys = leafKeys(en[sec], sec)
  const lit = keys.filter(k => used.has(k))
  const dyn = [...dynPrefix].filter(p => p === sec || p.startsWith(sec + ".") || (p.split(".")[0] === sec))
  const orphan = lit.length === 0 && dyn.length === 0
  console.log(
    String(keys.length).padStart(4) + " keys | lit " + String(lit.length).padStart(3) +
    " | dyn " + dyn.length + " | " + sec + (orphan ? "   <== KHONG AI DUNG" : "")
  )
}
