import { SEVERITY_ERROR, SEVERITY_WARNING } from '../constants/issueSeverity.js'

function isSectionHeader(line) {
  const s = line.trim()
  return s.startsWith('[') && s.endsWith(']') && s.length >= 3
}

function getSectionName(line) {
  return line.trim().slice(1, -1).trim()
}

function parseProtocolFromPLine(line) {
  // Example: "P 186058;;;;;;;;;;;;;;;;"
  const rest = line.trim().slice(1).trim()
  const firstField = rest.split(';')[0] || ''
  return firstField.trim().split(/\s+/)[0] || ''
}

function parseDLine(line) {
  // Example: "D 186058;0;3538LM8;S;1;1;1;0;41.0"
  const rest = line.trim().slice(1).trim()
  const parts = rest.split(';')

  const protocol = (parts[0] || '').trim().split(/\s+/)[0] || ''
  const qualiumCode = (parts[2] || '').trim()
  const rawResult = (parts[parts.length - 1] || '').trim()

  return { protocol, qualiumCode, rawResult, parts }
}

export function parseQualium(text) {
  const warnings = []
  const errors = []

  const source = String(text ?? '')
  const lines = source.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')

  if (lines.length === 0 || lines.every((l) => l.trim() === '')) {
    errors.push({
      severity: SEVERITY_ERROR,
      type: 'empty_file',
      message: 'El archivo está vacío.',
    })
    return { protocols: {}, protocolOrder: [], rows: [], warnings, errors, hasDataSection: false }
  }

  let inData = false
  let hasDataSection = false

  const protocols = {} // protocol -> { hasPatientLine: bool, determinations: [] }
  const protocolOrder = []
  const rows = [] // flattened determinations for preview

  for (let idx = 0; idx < lines.length; idx += 1) {
    const original = lines[idx]
    const line = original.trim()
    if (!line) continue

    if (isSectionHeader(line)) {
      const sectionName = getSectionName(line)
      if (sectionName.toLowerCase() === 'data') {
        inData = true
        hasDataSection = true
      } else {
        inData = false
      }
      continue
    }

    if (!inData) continue

    const kind = line[0]
    if (kind !== 'P' && kind !== 'D') {
      warnings.push({
        severity: SEVERITY_WARNING,
        type: 'malformed_line',
        lineNumber: idx + 1,
        message: `Se ignora una línea no compatible dentro de [Data]: "${original}"`,
      })
      continue
    }

    if (kind === 'P') {
      const protocol = parseProtocolFromPLine(line)
      if (!protocol) {
        warnings.push({
          severity: SEVERITY_WARNING,
          type: 'malformed_patient',
          lineNumber: idx + 1,
          message: `Línea de paciente malformada (falta el protocolo): "${original}"`,
        })
        continue
      }

      if (!protocols[protocol]) {
        protocols[protocol] = { protocol, hasPatientLine: false, determinations: [] }
        protocolOrder.push(protocol)
      }
      protocols[protocol].hasPatientLine = true
      continue
    }

    if (kind === 'D') {
      const parsed = parseDLine(line)
      if (!parsed.protocol || !parsed.qualiumCode) {
        warnings.push({
          severity: SEVERITY_WARNING,
          type: 'malformed_determination',
          lineNumber: idx + 1,
          message: `Línea de determinación malformada: "${original}"`,
        })
        continue
      }

      if (!protocols[parsed.protocol]) {
        protocols[parsed.protocol] = { protocol: parsed.protocol, hasPatientLine: false, determinations: [] }
        protocolOrder.push(parsed.protocol)
      }

      const row = {
        lineNumber: idx + 1,
        protocol: parsed.protocol,
        qualiumCode: parsed.qualiumCode,
        rawResult: parsed.rawResult,
        originalLine: original,
      }

      protocols[parsed.protocol].determinations.push(row)
      rows.push(row)
    }
  }

  if (!hasDataSection) {
    errors.push({
      severity: SEVERITY_ERROR,
      type: 'missing_data_section',
      message: 'Falta la sección obligatoria [Data]. Solo se procesan líneas dentro de [Data].',
    })
  } else if (rows.length === 0) {
    warnings.push({
      severity: SEVERITY_WARNING,
      type: 'empty_data_section',
      message: 'No se encontraron determinaciones dentro de [Data].',
    })
  }

  return { protocols, protocolOrder, rows, warnings, errors, hasDataSection }
}

