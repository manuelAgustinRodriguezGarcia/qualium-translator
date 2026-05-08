import { SEVERITY_ERROR, SEVERITY_WARNING } from '../constants/issueSeverity.js'

function normalizeHeader(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function detectDelimiter(line) {
  const semicolons = (line.match(/;/g) || []).length
  const commas = (line.match(/,/g) || []).length
  return semicolons >= commas ? ';' : ','
}

function parseCsvLine(line, delimiter) {
  const out = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        const next = line[i + 1]
        if (next === '"') {
          current += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        current += ch
      }
      continue
    }

    if (ch === '"') {
      inQuotes = true
      continue
    }

    if (ch === delimiter) {
      out.push(current)
      current = ''
      continue
    }

    current += ch
  }

  out.push(current)
  return out
}

function cell(row, idx) {
  if (idx == null) return ''
  return String(row[idx] ?? '').trim()
}

/**
 * Parse LabWin translation CSV. Rows with empty "Abreviación" inherit the last non-empty host code.
 * @returns {{
 *   mapping: Map<string, object>,
 *   rows: Array<{
 *     labwinCode: string,
 *     guestCode: string,
 *     resultName: string,
 *     description: string,
 *     sample: string,
 *     rotulo: string,
 *     delHost: string,
 *     alGuest: string,
 *     alHost: string,
 *     method: string,
 *     units: string,
 *     raw: string,
 *     lineIndex: number
 *   }>,
 *   warnings: object[],
 *   errors: object[],
 *   rowCount: number
 * }} Cada aviso/error incluye `severity` cuando aplica.
 */
export function parseLabwinTranslations(csvText) {
  const warnings = []
  const errors = []

  const source = String(csvText ?? '')
  const lines = source.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter((l) => l.trim() !== '')

  if (lines.length === 0) {
    errors.push({
      severity: SEVERITY_ERROR,
      type: 'empty_csv',
      message: 'El CSV de traducciones está vacío.',
    })
    return { mapping: new Map(), rows: [], warnings, errors, rowCount: 0 }
  }

  const delimiter = detectDelimiter(lines[0])
  const headerCells = parseCsvLine(lines[0], delimiter).map((c) => c.trim())
  const headerIndex = new Map()
  for (let i = 0; i < headerCells.length; i += 1) {
    headerIndex.set(normalizeHeader(headerCells[i]), i)
  }

  const hostKey = 'abreviación'
  const guestKey = 'abrev. guest'
  const descKey = 'descripción'
  const resultKey = 'resultado'
  const rotuloKey = 'rótulo'
  const muestraKey = 'muestra'
  const delHostKey = 'del host'
  const alGuestKey = 'al guest'
  const alHostKey = 'al host'
  const methodKey = 'método'
  const unitsKey = 'unidades'

  const hostIdx = headerIndex.get(hostKey)
  const guestIdx = headerIndex.get(guestKey)

  if (hostIdx == null || guestIdx == null) {
    errors.push({
      severity: SEVERITY_ERROR,
      type: 'missing_columns',
      message: 'Faltan columnas obligatorias en el CSV. Se esperan: "Abreviación" y "Abrev. Guest".',
    })
    return { mapping: new Map(), rows: [], warnings, errors, rowCount: 0 }
  }

  const descIdx = headerIndex.get(descKey)
  const resultIdx = headerIndex.get(resultKey)
  const rotuloIdx = headerIndex.get(rotuloKey)
  const muestraIdx = headerIndex.get(muestraKey)
  const delHostIdx = headerIndex.get(delHostKey)
  const alGuestIdx = headerIndex.get(alGuestKey)
  const alHostIdx = headerIndex.get(alHostKey)
  const methodIdx = headerIndex.get(methodKey)
  const unitsIdx = headerIndex.get(unitsKey)

  const mapping = new Map()
  const rows = []
  let mappedRows = 0
  let currentHostCode = ''

  for (let lineNo = 1; lineNo < lines.length; lineNo += 1) {
    const lineText = lines[lineNo]
    const row = parseCsvLine(lineText, delimiter)
    const abrevRaw = cell(row, hostIdx)
    const guest = cell(row, guestIdx)

    if (abrevRaw) {
      currentHostCode = abrevRaw
    }

    const labwinCode = currentHostCode
    const description = cell(row, descIdx)
    const resultName = cell(row, resultIdx)
    const rotulo = cell(row, rotuloIdx)
    const muestra = cell(row, muestraIdx)
    const delHost = cell(row, delHostIdx)
    const alGuest = cell(row, alGuestIdx)
    const alHost = cell(row, alHostIdx)
    const method = cell(row, methodIdx)
    const units = cell(row, unitsIdx)

    rows.push({
      labwinCode,
      guestCode: guest,
      resultName,
      description,
      sample: muestra,
      rotulo,
      delHost,
      alGuest,
      alHost,
      method,
      units,
      raw: lineText,
      lineIndex: lineNo,
    })

    if (!labwinCode || !guest) {
      continue
    }

    const entry = {
      labwinCode,
      guestCode: guest,
      description,
      resultName,
      delHost,
      alGuest,
      alHost,
    }

    if (mapping.has(guest)) {
      const existing = mapping.get(guest)
      if (existing.labwinCode === labwinCode) {
        continue
      }
      warnings.push({
        severity: SEVERITY_WARNING,
        type: 'guest_mapping_conflict',
        guestCode: guest,
        message: `Conflicto de mapeo: el código Guest "${guest}" ya estaba asignado a "${existing.labwinCode}" y en el CSV también aparece como "${labwinCode}". Se mantiene el primer mapeo ("${existing.labwinCode}").`,
      })
      continue
    }

    mapping.set(guest, entry)
    mappedRows += 1
  }

  if (mapping.size === 0) {
    warnings.push({
      severity: SEVERITY_WARNING,
      type: 'no_mappings',
      message: 'No se encontraron mapeos válidos Guest → Host en el CSV.',
    })
  }

  return { mapping, rows, warnings, errors, rowCount: mappedRows }
}
