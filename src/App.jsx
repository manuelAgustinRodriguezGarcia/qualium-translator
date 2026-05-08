import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeftRight,
  Copy,
  Download,
  Eye,
  FileUp,
  Search,
  Table2,
  TriangleAlert,
} from 'lucide-react'
import './App.css'
import { SEVERITY_ERROR, SEVERITY_INFO, SEVERITY_WARNING } from './constants/issueSeverity.js'
import { parseQualium } from './utils/parseQualium.js'
import { generateBid } from './utils/generateBid.js'
import { parseLabwinTranslations } from './utils/parseLabwinTranslations.js'
import { decodeQualiumArrayBuffer, encodeLatin1 } from './utils/encoding.js'

function ensureSeverity(item, fallback) {
  if (item?.severity) return item
  return { ...item, severity: fallback }
}

function formatRotuloMuestra(row) {
  const parts = [row.rotulo, row.sample].filter(Boolean)
  return parts.length ? parts.join(' · ') : ''
}

function EmptyCell({ children }) {
  if (children == null || children === '') return <span className="muted">—</span>
  return children
}

function App() {
  const inputRef = useRef(null)
  const [isDragActive, setIsDragActive] = useState(false)

  const [selectedFile, setSelectedFile] = useState(null)

  const [parseResult, setParseResult] = useState(null)
  const [convertResult, setConvertResult] = useState(null)

  const [csvStatus, setCsvStatus] = useState({ state: 'loading', message: 'Cargando mapeos…' })
  const [guestToHost, setGuestToHost] = useState(new Map())
  const [csvWarnings, setCsvWarnings] = useState([])
  const [csvTranslationRows, setCsvTranslationRows] = useState([])
  const [translationSearch, setTranslationSearch] = useState('')

  useEffect(() => {
    let cancelled = false

    async function loadCsv() {
      try {
        setCsvStatus({ state: 'loading', message: 'Cargando mapeos…' })
        const res = await fetch('/data/labwin_translations.csv', { cache: 'no-cache' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)

        const text = await res.text()
        const parsed = parseLabwinTranslations(text)
        if (parsed.errors.length) {
          if (!cancelled) {
            setCsvStatus({ state: 'error', message: parsed.errors[0].message })
            setGuestToHost(new Map())
            setCsvWarnings(parsed.warnings)
            setCsvTranslationRows([])
          }
          return
        }

        if (!cancelled) {
          setGuestToHost(parsed.mapping)
          setCsvWarnings(parsed.warnings)
          setCsvTranslationRows(parsed.rows ?? [])
          setCsvStatus({ state: 'ready', message: `Mapeos cargados: ${parsed.mapping.size}` })
        }
      } catch (e) {
        if (!cancelled) {
          setCsvStatus({
            state: 'error',
            message: `No se pudo cargar el CSV de mapeos: ${String(e?.message || e)}`,
          })
          setGuestToHost(new Map())
          setCsvWarnings([])
          setCsvTranslationRows([])
        }
      }
    }

    void loadCsv()
    return () => {
      cancelled = true
    }
  }, [])

  async function handleFile(file) {
    setSelectedFile(file)
    setConvertResult(null)

    if (!file) {
      setParseResult(null)
      return
    }

    const name = file.name || ''
    const isTxt = name.toLowerCase().endsWith('.txt')
    if (!isTxt) {
      setParseResult({
        protocols: {},
        protocolOrder: [],
        rows: [],
        warnings: [],
        errors: [
          {
            severity: SEVERITY_ERROR,
            type: 'file_type',
            message: 'Solo se admiten archivos .txt.',
          },
        ],
        hasDataSection: false,
      })
      return
    }

    const buf = await file.arrayBuffer()
    const decoded = decodeQualiumArrayBuffer(buf)
    const parsed = parseQualium(decoded.text)
    const decodeWarning = decoded.encoding.includes('utf-8') ? null : decoded.encoding
    if (decodeWarning) {
      parsed.warnings = [
        {
          severity: SEVERITY_INFO,
          type: 'encoding_fallback',
          message: `Decodificado usando ${decoded.encoding}.`,
        },
        ...(parsed.warnings || []),
      ]
    }
    setParseResult(parsed)
  }

  function onPickClick() {
    inputRef.current?.click()
  }

  function onInputChange(e) {
    const file = e.target.files?.[0] || null
    void handleFile(file)
  }

  function onDrop(e) {
    e.preventDefault()
    setIsDragActive(false)
    const file = e.dataTransfer.files?.[0] || null
    void handleFile(file)
  }

  function onDragOver(e) {
    e.preventDefault()
    setIsDragActive(true)
  }

  function onDragLeave() {
    setIsDragActive(false)
  }

  function onConvert() {
    if (!parseResult) return
    if (csvStatus.state !== 'ready') {
      setConvertResult({
        bidText: '',
        filename: '',
        issues: [
          {
            severity: SEVERITY_ERROR,
            type: 'csv_not_ready',
            message: 'El CSV de mapeos todavía no está cargado.',
          },
        ],
        preview: [],
        unmapped: [],
        convertedCount: 0,
      })
      return
    }

    const protocols = {}
    for (const protocol of parseResult.protocolOrder || Object.keys(parseResult.protocols || {})) {
      const src = parseResult.protocols?.[protocol]
      if (!src) continue
      protocols[protocol] = {
        ...src,
        determinations: (src.determinations || []).map((d) => {
          const meta = guestToHost.get(d.qualiumCode)
          return {
            ...d,
            labwinCode: meta?.labwinCode ?? null,
            translationMeta: meta ?? null,
          }
        }),
      }
    }

    setConvertResult(generateBid({ protocols, protocolOrder: parseResult.protocolOrder }))
  }

  function onNewFile() {
    setSelectedFile(null)
    setParseResult(null)
    setConvertResult(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  function onDownload() {
    if (!convertResult?.bidText || !convertResult?.filename) return
    if (!convertResult.convertedCount) return
    const encoded = encodeLatin1(convertResult.bidText)
    const blob = new Blob([encoded.bytes], { type: 'text/plain;charset=iso-8859-1' })
    const url = URL.createObjectURL(blob)

    const a = document.createElement('a')
    a.href = url
    a.download = convertResult.filename
    document.body.appendChild(a)
    a.click()
    a.remove()

    URL.revokeObjectURL(url)
  }

  const qualiumGuestCodes = useMemo(() => {
    const set = new Set()
    for (const r of parseResult?.rows || []) set.add(r.qualiumCode)
    return set
  }, [parseResult?.rows])

  const filteredCsvWarnings = useMemo(() => {
    return csvWarnings.filter((w) => {
      if (w.type !== 'guest_mapping_conflict') return true
      const code = w.guestCode
      if (code == null || code === '') return true
      if (!parseResult?.rows?.length) return false
      return qualiumGuestCodes.has(code)
    })
  }, [csvWarnings, parseResult?.rows, qualiumGuestCodes])

  const allIssues = useMemo(() => {
    const out = []
    for (const w of filteredCsvWarnings) out.push(ensureSeverity(w, SEVERITY_WARNING))
    for (const w of parseResult?.warnings || []) out.push(ensureSeverity(w, SEVERITY_WARNING))
    for (const e of parseResult?.errors || []) out.push(ensureSeverity(e, SEVERITY_ERROR))
    for (const i of convertResult?.issues || []) out.push(ensureSeverity(i, SEVERITY_WARNING))
    return out
  }, [filteredCsvWarnings, parseResult, convertResult])

  const issuesBySeverity = useMemo(() => {
    const groups = { error: [], warning: [], info: [] }
    for (const item of allIssues) {
      if (item.severity === SEVERITY_ERROR) groups.error.push(item)
      else if (item.severity === SEVERITY_WARNING) groups.warning.push(item)
      else groups.info.push(item)
    }
    return groups
  }, [allIssues])

  const errorCount = issuesBySeverity.error.length
  const warningCount = issuesBySeverity.warning.length
  const infoCount = issuesBySeverity.info.length

  const canConvert =
    Boolean(selectedFile) &&
    Boolean(parseResult) &&
    (parseResult?.errors || []).length === 0 &&
    (parseResult?.rows || []).length > 0 &&
    csvStatus.state === 'ready'

  const canDownload = Boolean(convertResult?.bidText) && (convertResult?.convertedCount || 0) > 0

  const unmappedRows = convertResult?.unmapped || []

  const fullPreviewRows = useMemo(() => {
    if (!convertResult) return []
    const mapped = (convertResult.preview || []).map((r) => ({ ...r, includedInBid: true }))
    const unmapped = (convertResult.unmapped || []).map((r) => ({
      ...r,
      labwinCode: r.labwinCode ?? null,
      normalizedResult: null,
      decimals: null,
      includedInBid: false,
    }))
    return [...mapped, ...unmapped].sort((a, b) => (a.lineNumber || 0) - (b.lineNumber || 0))
  }, [convertResult])

  const filteredTranslationRows = useMemo(() => {
    const q = translationSearch.trim().toLowerCase()
    if (!q) return csvTranslationRows
    return csvTranslationRows.filter((r) => {
      const hay = [r.labwinCode, r.guestCode, r.description, r.resultName, r.method, r.units]
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
  }, [csvTranslationRows, translationSearch])

  async function onCopyIssues() {
    const blocks = []
    if (issuesBySeverity.error.length) {
      blocks.push(`ERRORES (${issuesBySeverity.error.length})`)
      for (const x of issuesBySeverity.error) blocks.push(`- ${x.message}`)
    }
    if (issuesBySeverity.warning.length) {
      if (blocks.length) blocks.push('')
      blocks.push(`AVISOS (${issuesBySeverity.warning.length})`)
      for (const x of issuesBySeverity.warning) blocks.push(`- ${x.message}`)
    }
    if (issuesBySeverity.info.length) {
      if (blocks.length) blocks.push('')
      blocks.push(`INFORMACIÓN (${issuesBySeverity.info.length})`)
      for (const x of issuesBySeverity.info) blocks.push(`- ${x.message}`)
    }
    const text = blocks.join('\n')
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = text
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      ta.remove()
    }
  }

  const showExportEmptyNote =
    Boolean(convertResult) &&
    (convertResult?.convertedCount || 0) === 0 &&
    (parseResult?.rows?.length || 0) > 0

  return (
    <div className="appShell">
      <header className="topNav">
        <div className="topNavInner">
          <div className="brand">
            <h1 className="brandTitle">QUALIUM Translator</h1>
            <p className="brandSubtitle topNavMetaMobileHidden">
              Convierte archivos de resultados de QUALIUM en archivos .bid compatibles con LabWin.
            </p>
          </div>
        </div>
      </header>

      <main className="main">
        <section className="card" aria-label="Subir y convertir">
          <div className="cardHeader">
            <div className="cardTitleRow">
              <span className="cardTitleIconWrap" aria-hidden="true">
                <FileUp className="cardTitleIcon" strokeWidth={2} />
              </span>
              <h2 className="cardTitle">Subir QUALIUM .txt</h2>
            </div>
            <span
              className={`pill ${
                csvStatus.state === 'ready' ? 'pillOk' : csvStatus.state === 'error' ? 'pillError' : 'pillWarn'
              }`}
            >
              {csvStatus.state === 'loading'
                ? 'Traducciones: cargando'
                : csvStatus.state === 'ready'
                  ? 'Traducciones: OK'
                  : 'Traducciones: error'}
            </span>
          </div>

          <input
            ref={inputRef}
            className="srOnly"
            type="file"
            accept=".txt,text/plain"
            onChange={onInputChange}
          />

          {!selectedFile ? (
            <div
              className={`dropzone ${isDragActive ? 'dropzoneActive' : ''}`}
              role="button"
              tabIndex={0}
              onClick={onPickClick}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') onPickClick()
              }}
              onDrop={onDrop}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              aria-label="Arrastra y suelta un archivo QUALIUM .txt o haz clic para seleccionarlo."
            >
              <p className="dropzoneTitle">Arrastra y suelta tu archivo .txt aquí</p>
              <p className="dropzoneHint">O haz clic para seleccionar. Solo se admite .txt.</p>
            </div>
          ) : null}

          {selectedFile ? (
            <>
              <div className="fileRow" aria-label="Archivo seleccionado">
                <div className="fileName" title={selectedFile.name}>
                  {selectedFile.name}
                </div>
                <div className="actions">
                  <div className="swapWrap" aria-label="Acción principal">
                    <div className={`swapItem ${convertResult ? 'swapItemHidden' : 'swapItemVisible'}`}>
                      <button type="button" className="button buttonTint" onClick={onConvert} disabled={!canConvert}>
                        <ArrowLeftRight className="buttonIcon" aria-hidden="true" />
                        Convertir a .bid
                      </button>
                    </div>
                    <div className={`swapItem ${convertResult ? 'swapItemVisible' : 'swapItemHidden'}`}>
                      <button
                        type="button"
                        className="button buttonSolid"
                        onClick={onDownload}
                        disabled={!canDownload}
                      >
                        <Download className="buttonIcon" aria-hidden="true" />
                        Descargar .bid
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="centerRow">
                <button type="button" className="button buttonTint" onClick={onNewFile}>
                  Transformar nuevo archivo
                </button>
              </div>
            </>
          ) : null}
        </section>

        <aside className="panelList" aria-label="Paneles de validación">
          <section className={`card ${convertResult ? 'growIn' : ''}`} aria-label="Vista previa de conversión">
            <div className="cardHeader">
              <div className="cardTitleRow">
                <span className="cardTitleIconWrap" aria-hidden="true">
                  <Eye className="cardTitleIcon" strokeWidth={2} />
                </span>
                <h2 className="cardTitle">Vista previa</h2>
              </div>
              <span className="pill">
                Filas: {parseResult?.rows?.length || 0} · Convertidas: {convertResult?.convertedCount || 0} · Sin mapear:{' '}
                {unmappedRows.length}
              </span>
            </div>

            {!selectedFile ? (
              <p className="muted">Sube un archivo QUALIUM .txt para ver la vista previa antes de descargar.</p>
            ) : null}

            {selectedFile && parseResult && !convertResult ? (
              <p className="muted">
                Se analizaron {parseResult.rows.length} fila(s). Haz clic en <strong>Convertir a .bid</strong> para generar una
                vista previa compatible con LabWin y habilitar la descarga.
              </p>
            ) : null}

            {convertResult && unmappedRows.length > 0 ? (
              <p className="callout calloutWarn" role="status">
                Las filas con códigos sin mapear no se incluirán en el archivo .bid.
              </p>
            ) : null}

            {showExportEmptyNote ? (
              <p className="muted">
                No hay determinaciones con mapeo válido para exportar. Revisa los errores o el CSV de traducciones.
              </p>
            ) : null}

            {fullPreviewRows.length ? (
              <div className="tableWrap" role="region" aria-label="Vista previa de filas">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Protocolo</th>
                      <th scope="col">Código Guest</th>
                      <th scope="col">Código LabWin</th>
                      <th scope="col">Resultado original</th>
                      <th scope="col">Normalizado</th>
                      <th scope="col">En .bid</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fullPreviewRows.slice(0, 200).map((r) => (
                      <tr
                        key={`${r.protocol}-${r.lineNumber}-${r.qualiumCode}-${r.includedInBid ? 'm' : 'u'}`}
                        className={r.includedInBid ? undefined : 'rowExcluded'}
                      >
                        <td>
                          <code>{r.protocol}</code>
                        </td>
                        <td>
                          <code>{r.qualiumCode}</code>
                        </td>
                        <td>{r.labwinCode ? <code>{r.labwinCode}</code> : <span className="muted">—</span>}</td>
                        <td>{r.rawResult || <span className="muted">—</span>}</td>
                        <td>
                          {r.normalizedResult ? <code>{r.normalizedResult}</code> : <span className="muted">—</span>}
                        </td>
                        <td>
                          {r.includedInBid ? (
                            <span className="tagOk">Sí</span>
                          ) : (
                            <span className="tagMuted">No</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            {fullPreviewRows.length > 200 ? (
              <p className="footerNote">
                Mostrando las primeras 200 filas por rendimiento. El .bid descargado incluye todas las filas marcadas como
                «Sí» en «En .bid».
              </p>
            ) : null}
          </section>

          <section className="card" aria-label="Avisos y errores">
            <div className="cardHeader">
              <div className="cardTitleRow">
                <span className="cardTitleIconWrap" aria-hidden="true">
                  <TriangleAlert className="cardTitleIcon" strokeWidth={2} />
                </span>
                <h2 className="cardTitle">Avisos y errores</h2>
              </div>
              <div className="actions" aria-label="Contadores por gravedad">
                <span className={`pill ${errorCount ? 'pillError' : 'pillOk'}`}>Errores: {errorCount}</span>
                <span className={`pill ${warningCount ? 'pillWarn' : 'pillOk'}`}>Avisos: {warningCount}</span>
                <span className={`pill ${infoCount ? 'pillInfo' : 'pillOk'}`}>Información: {infoCount}</span>
              </div>
            </div>

            {errorCount === 0 && warningCount === 0 && infoCount === 0 ? (
              <p className="muted">Todavía no hay mensajes.</p>
            ) : (
              <>
                <div className="fileRow issueCopyRow" aria-label="Copiar listado">
                  <div className="muted">Copia el listado agrupado con etiquetas de gravedad.</div>
                  <div className="actions">
                    <button type="button" className="button buttonTint" onClick={onCopyIssues}>
                      <Copy className="buttonIcon" aria-hidden="true" />
                      Copiar avisos
                    </button>
                  </div>
                </div>

                {issuesBySeverity.error.length ? (
                  <div className="issueGroup issueGroupError" aria-label="Errores">
                    <h3 className="issueGroupTitle">
                      Errores <span className="issueCount">({issuesBySeverity.error.length})</span>
                    </h3>
                    <ul className="list">
                      {issuesBySeverity.error.map((e, i) => (
                        <li key={`err-${e.type}-${i}`}>{e.message}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {issuesBySeverity.warning.length ? (
                  <div className="issueGroup issueGroupWarning" aria-label="Avisos">
                    <h3 className="issueGroupTitle">
                      Avisos <span className="issueCount">({issuesBySeverity.warning.length})</span>
                    </h3>
                    <ul className="list">
                      {issuesBySeverity.warning.map((w, i) => (
                        <li key={`warn-${w.type}-${i}`}>{w.message}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {issuesBySeverity.info.length ? (
                  <div className="issueGroup issueGroupInfo" aria-label="Información">
                    <h3 className="issueGroupTitle">
                      Información <span className="issueCount">({issuesBySeverity.info.length})</span>
                    </h3>
                    <ul className="list">
                      {issuesBySeverity.info.map((info, i) => (
                        <li key={`info-${info.type}-${i}`}>{info.message}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </>
            )}
          </section>

          <section className="card refTableSection" aria-label="Tabla de traducciones LabWin">
            <div className="cardHeader refTableHeader">
              <div className="refTableHeaderText">
                <div className="cardTitleRow cardTitleRowAlignStart">
                  <span className="cardTitleIconWrap" aria-hidden="true">
                    <Table2 className="cardTitleIcon" strokeWidth={2} />
                  </span>
                  <div className="refTableTitleBlock">
                    <h2 className="cardTitle">Tabla de traducciones LabWin</h2>
                    <p className="cardSubtitle">
                      Consulta los códigos Host y Guest cargados desde el CSV de traducciones.
                    </p>
                  </div>
                </div>
              </div>
              {csvStatus.state === 'ready' && csvTranslationRows.length > 0 ? (
                <span className="pill pillOk refTableBadge">{csvTranslationRows.length} traducciones cargadas</span>
              ) : null}
            </div>

            {csvStatus.state === 'loading' ? (
              <p className="muted" role="status">
                Cargando tabla de traducciones…
              </p>
            ) : null}

            {csvStatus.state === 'error' ? (
              <p className="muted" role="alert">
                No se pudo mostrar la tabla de referencia. {csvStatus.message}
              </p>
            ) : null}

            {csvStatus.state === 'ready' && csvTranslationRows.length === 0 ? (
              <p className="muted">No hay filas de traducción en el CSV.</p>
            ) : null}

            {csvStatus.state === 'ready' && csvTranslationRows.length > 0 ? (
              <>
                <div className="refSearchRow">
                  <label className="refSearchField" htmlFor="ref-translation-search">
                    <Search className="refSearchIcon" aria-hidden="true" />
                    <span className="srOnly">Buscar en la tabla de traducciones</span>
                    <input
                      id="ref-translation-search"
                      className="refSearchInput"
                      type="search"
                      autoComplete="off"
                      placeholder="Buscar por Host, Guest, descripción, resultado, método o unidades…"
                      value={translationSearch}
                      onChange={(e) => setTranslationSearch(e.target.value)}
                      aria-describedby="ref-translation-count"
                    />
                  </label>
                </div>
                <p id="ref-translation-count" className="refResultsCount">
                  {filteredTranslationRows.length === csvTranslationRows.length
                    ? `Mostrando todas las filas (${csvTranslationRows.length}).`
                    : `Mostrando ${filteredTranslationRows.length} de ${csvTranslationRows.length} filas.`}
                </p>
                <div className="tableWrap refTableWrap" role="region" aria-label="Filas del CSV de traducciones">
                  <table className="table tableCompact refTable">
                    <thead>
                      <tr>
                        <th scope="col">Host / LabWin</th>
                        <th scope="col">Guest / QUALIUM</th>
                        <th scope="col">Resultado</th>
                        <th scope="col">Descripción</th>
                        <th scope="col">Muestra / Rótulo</th>
                        <th scope="col">Del Host</th>
                        <th scope="col">Al Guest</th>
                        <th scope="col">Al Host</th>
                        <th scope="col">Método</th>
                        <th scope="col">Unidades</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTranslationRows.map((r) => {
                        const rotuloMuestra = formatRotuloMuestra(r)
                        return (
                          <tr key={`csv-row-${r.lineIndex}`}>
                            <td>
                              <EmptyCell>{r.labwinCode ? <code>{r.labwinCode}</code> : null}</EmptyCell>
                            </td>
                            <td>
                              <EmptyCell>{r.guestCode ? <code>{r.guestCode}</code> : null}</EmptyCell>
                            </td>
                            <td>
                              <EmptyCell>{r.resultName}</EmptyCell>
                            </td>
                            <td>
                              <EmptyCell>{r.description}</EmptyCell>
                            </td>
                            <td>
                              <EmptyCell>{rotuloMuestra || null}</EmptyCell>
                            </td>
                            <td>
                              <EmptyCell>{r.delHost}</EmptyCell>
                            </td>
                            <td>
                              <EmptyCell>{r.alGuest}</EmptyCell>
                            </td>
                            <td>
                              <EmptyCell>{r.alHost}</EmptyCell>
                            </td>
                            <td>
                              <EmptyCell>{r.method}</EmptyCell>
                            </td>
                            <td>
                              <EmptyCell>{r.units}</EmptyCell>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            ) : null}
          </section>
        </aside>
      </main>
    </div>
  )
}

export default App
