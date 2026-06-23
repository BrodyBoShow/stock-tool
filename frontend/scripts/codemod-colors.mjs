/**
 * One-shot codemod: convert Tailwind *arbitrary* color values to canonical palette
 * classes, e.g.  text-[#64748b] -> text-slate-500 ,  hover:bg-[#4338ca] -> hover:bg-indigo-700.
 *
 * Source of truth is tailwindcss's own default palette, so every conversion is
 * COLOR-PRESERVING (same hex -> identical compiled CSS). Anything that isn't an exact
 * match to a Tailwind shade (custom hex, 8-digit alpha hex) is left as an arbitrary value.
 * Hex inside JS/SVG/Recharts string props ("#fff") is untouched — we only match the
 * `prefix-[#hex]` className syntax.
 *
 * Usage:  node scripts/codemod-colors.mjs --dry   (preview counts, no writes)
 *         node scripts/codemod-colors.mjs         (apply)
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const twColors = require('tailwindcss/colors')

const DRY = process.argv.includes('--dry')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src')

// Deprecated aliases share hex with canonical families — skip so the canonical name wins.
const SKIP = new Set(['lightBlue', 'warmGray', 'trueGray', 'coolGray', 'blueGray'])

const hexToClass = new Map([
  ['#ffffff', 'white'],
  ['#000000', 'black'],
])
for (const family of Object.keys(twColors)) {
  if (SKIP.has(family)) continue
  const val = twColors[family]
  if (typeof val !== 'object' || val === null) continue
  for (const [shade, hex] of Object.entries(val)) {
    if (typeof hex !== 'string' || hex.length !== 7) continue // 6-digit only
    const h = hex.toLowerCase()
    if (!hexToClass.has(h)) hexToClass.set(h, `${family}-${shade}`)
  }
}

// Color utility prefixes that accept an arbitrary color value. (shadow excluded: ambiguous.)
const PREFIX =
  '(?:text|bg|decoration|border(?:-[trblxyse])?|ring(?:-offset)?|divide|outline|fill|stroke|from|via|to|accent|caret|placeholder)'
const RE = new RegExp(PREFIX + '-\\[(#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6})\\]', 'g')

const norm = (hex) => {
  let h = hex.toLowerCase()
  if (h.length === 4) h = '#' + [...h.slice(1)].map((c) => c + c).join('')
  return h
}

let files = 0
let total = 0
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p)
    else if (e.name.endsWith('.tsx') || e.name.endsWith('.ts')) processFile(p)
  }
}
function processFile(p) {
  const src = fs.readFileSync(p, 'utf8')
  let n = 0
  const out = src.replace(RE, (m, hex) => {
    const cls = hexToClass.get(norm(hex))
    if (!cls) return m
    n++
    // m starts with the prefix; replace only the trailing -[#hex] segment.
    return m.slice(0, m.indexOf('-[')) + '-' + cls
  })
  if (n > 0) {
    files++
    total += n
    if (!DRY) fs.writeFileSync(p, out)
    console.log(`${String(n).padStart(4)}  ${path.relative(root, p)}`)
  }
}
walk(root)
console.log(
  `\n${DRY ? '[dry] ' : ''}${total} replacements across ${files} files (${hexToClass.size} palette entries)`,
)
