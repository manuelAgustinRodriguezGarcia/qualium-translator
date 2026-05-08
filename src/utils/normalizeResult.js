import { SEVERITY_INFO, SEVERITY_WARNING } from '../constants/issueSeverity.js'

function stripLeadingZeros(value) {
  const s = String(value)
  const stripped = s.replace(/^0+(?=\d)/, '')
  return stripped.length === 0 ? '0' : stripped
}

function roundDecimalString({ intPart, fracPart }, decimals) {
  if (decimals <= 0) {
    if (!fracPart || fracPart.length === 0) return intPart
    const first = fracPart[0] || '0'
    if (first >= '5') {
      return (BigInt(intPart || '0') + 1n).toString()
    }
    return intPart || '0'
  }

  const needed = decimals
  const current = (fracPart || '').padEnd(needed + 1, '0')
  const keep = current.slice(0, needed)
  const next = current[needed] || '0'

  if (next < '5') return `${intPart || '0'}.${keep}`

  const base = BigInt((intPart || '0') + keep)
  const bumped = base + 1n
  const bumpedStr = bumped.toString().padStart((intPart || '0').length + needed, '0')
  const newInt = bumpedStr.slice(0, -needed) || '0'
  const newFrac = bumpedStr.slice(-needed)
  return `${newInt}.${newFrac}`
}

function toImplicitDecimals(numberString, decimals) {
  const clean = String(numberString).trim().replace(',', '.')
  const m = clean.match(/^([+-])?(\d+)(?:\.(\d+))?$/)
  if (!m) return null

  const sign = m[1] || ''
  const intPart = m[2] || '0'
  const fracPart = m[3] || ''

  const rounded = roundDecimalString({ intPart, fracPart }, Math.max(0, decimals))
  const mm = rounded.match(/^(\d+)(?:\.(\d+))?$/)
  if (!mm) return null

  const i = mm[1]
  const f = (mm[2] || '').padEnd(Math.max(0, decimals), '0')

  const combined = decimals > 0 ? `${i}${f.slice(0, decimals)}` : i
  const normalized = stripLeadingZeros(combined)
  return `${sign}${normalized}`
}

function formatContext(ctx) {
  if (!ctx) return ''
  const parts = []
  if (ctx.protocol) parts.push(`protocolo ${ctx.protocol}`)
  if (ctx.qualiumCode) parts.push(`código QUALIUM ${ctx.qualiumCode}`)
  if (parts.length === 0) return ''
  return ` (${parts.join(', ')})`
}

/**
 * Normalize QUALIUM result into LabWin implicit-decimal format.
 * - Preserves comparison symbols like "< 0.42" when present.
 * - If result is non-numeric, preserves text and emits a warning (with optional context).
 */
export function normalizeResult(rawResult, decimals, { context } = {}) {
  const warnings = []
  const suffix = formatContext(context)
  const source = String(rawResult ?? '').trim()
  if (!source) return { value: '', warnings }

  const match = source.match(/([-+]?\d+(?:[.,]\d+)?)/)
  if (!match) {
    warnings.push({
      severity: SEVERITY_INFO,
      type: 'text_result_preserved',
      message: `Resultado textual preservado: "${source}"${suffix}`,
    })
    return { value: source, warnings }
  }

  const numeric = match[1]
  const implicit = toImplicitDecimals(numeric, decimals)
  if (!implicit) {
    warnings.push({
      severity: SEVERITY_WARNING,
      type: 'result_not_normalized',
      message: `No se pudo normalizar el resultado; se preserva tal cual: "${source}"${suffix}`,
    })
    return { value: source, warnings }
  }

  const before = source.slice(0, match.index).trimEnd()
  const after = source.slice((match.index || 0) + numeric.length).trimStart()

  const comparatorOnly = before.length > 0 && /^[<>=≤≥]+$/.test(before)
  const glueBefore = before.length ? (comparatorOnly ? before : `${before} `) : ''
  const glueAfter = after.length ? ` ${after}` : ''
  return { value: `${glueBefore}${implicit}${glueAfter}`.trim(), warnings }
}
