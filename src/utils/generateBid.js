import { DECIMAL_CONFIG, DEFAULT_DECIMALS } from '../constants/decimalConfig.js'
import { SEVERITY_ERROR, SEVERITY_WARNING } from '../constants/issueSeverity.js'
import { normalizeResult } from './normalizeResult.js'

function pad2(n) {
  return String(n).padStart(2, '0')
}

function formatDateTokens(now) {
  const yyyy = now.getFullYear()
  const mm = pad2(now.getMonth() + 1)
  const dd = pad2(now.getDate())
  const HH = pad2(now.getHours())
  const MM = pad2(now.getMinutes())

  return {
    yyyymmdd: `${yyyy}${mm}${dd}`,
    ddmmyyyy: `${dd}-${mm}-${yyyy}`,
    hhmm: `${HH}${MM}`,
    hhColonMm: `${HH}:${MM}`,
  }
}

const BID_HEADER = `[BiDirecc]
Numero;Fecha;Hora;HClin;Nombre;Sexo;FNacim;NDia;Pieza;Mutual;Coseguro;Medico;NumMedico;NumDeriv;Carnet;Telefono;Direccion;Localidad;Entrega;Bioquimico;Observ;DebeBono;Caratula;Facturado;FacturaIVA;Exportado;Importado;EnviadoEmail;Web;Urgente;FechUlImp;HorUlImp;VecesImp;Sucursal;ADomicilio;Origen;Diagnostico;Email;PorEMail;NClin;NumBono;Total;Pagado;WebPassWord;Debe;ImportNumOrig;NumAutoriz;FechaPresc;FlagClinica;Segna;Retirado;Tubos;Diagnostico2;NombreDePila;Apellido;TipoDoc;FechaAuto;Afiliacion;FechaAtenc;Internado;FUM;Peso;Altura;HAyuno;Extraccion;NumEnvio;Celular;PorCelular;EnviadoCelular;PorCloud;IDTurno;IDOtroSistema;ExportadoPDF;EnviadoWhatsApp;MontoCoseguro;EnviarWhatsApp

[Determinaciones]
Numero;Sucursal;Abrev;Operador;NumBono;Autoriz;Autorizado;Impreso;FactuImpreso;BidireccFlags;Facturar;Informar;TrajoMuestra;Cargado;Validado;AutoVal;Modificado;Orden;EnLaOrden;NumTubo;UltModif;Nota;Result;ResultRep;BiDirID;Fecha;Hora

[Data]`

function buildPLine(protocol, ddmmyyyy, hhColonMm) {
  const base = [`${protocol}`, ddmmyyyy, hhColonMm]
  const totalColumns = BID_HEADER.split('\n')[1].split(';').length
  while (base.length < totalColumns) base.push('')
  return `P ${base.join(';')}`
}

function buildDLine({ protocol, labwinCode, normalizedResult, order, yyyymmdd, ddmmyyyy, hhColonMm }) {
  return `D ${protocol};0;${labwinCode};17;0;0;;0;;18;;1;${yyyymmdd};1;1;;0;${order};;;;0;${normalizedResult};;Deriv_Qualium;${ddmmyyyy};${hhColonMm}`
}

export function generateBid({ protocols, protocolOrder }) {
  const now = new Date()
  const { yyyymmdd, ddmmyyyy, hhmm, hhColonMm } = formatDateTokens(now)

  const issues = []

  const protocolNumbers =
    Array.isArray(protocolOrder) && protocolOrder.length ? protocolOrder : Object.keys(protocols || {})

  if (protocolNumbers.length === 0) {
    issues.push({
      severity: SEVERITY_ERROR,
      type: 'no_protocols',
      message: 'No se encontraron protocolos para exportar.',
    })
    return { bidText: '', filename: '', issues, preview: [], unmapped: [], convertedCount: 0 }
  }

  const lines = [BID_HEADER]
  const preview = []
  const unmapped = []
  let convertedCount = 0

  const defaultDecimalLabwinWarned = new Set()

  for (const protocol of protocolNumbers) {
    const determinations = protocols[protocol]?.determinations || []
    let order = 1
    let wroteP = false

    for (const det of determinations) {
      const labwinCode = det.labwinCode || null
      if (!labwinCode) {
        issues.push({
          severity: SEVERITY_ERROR,
          type: 'unmapped_row',
          message: `Código Guest sin mapeo "${det.qualiumCode}" (protocolo ${protocol}, línea ${det.lineNumber}).`,
        })
        unmapped.push({ ...det, labwinCode: null })
        continue
      }

      const decimals = Object.prototype.hasOwnProperty.call(DECIMAL_CONFIG, labwinCode)
        ? DECIMAL_CONFIG[labwinCode]
        : DEFAULT_DECIMALS

      if (!Object.prototype.hasOwnProperty.call(DECIMAL_CONFIG, labwinCode)) {
        if (!defaultDecimalLabwinWarned.has(labwinCode)) {
          defaultDecimalLabwinWarned.add(labwinCode)
          issues.push({
            severity: SEVERITY_WARNING,
            type: 'default_decimals_used',
            message: `Se usaron decimales por defecto (2) para el código LabWin "${labwinCode}".`,
          })
        }
      }

      const normalized = normalizeResult(det.rawResult, decimals, {
        context: { protocol, qualiumCode: det.qualiumCode },
      })
      for (const w of normalized.warnings) issues.push(w)

      if (!wroteP) {
        lines.push(buildPLine(protocol, ddmmyyyy, hhColonMm))
        wroteP = true
      }

      lines.push(
        buildDLine({
          protocol,
          labwinCode,
          normalizedResult: normalized.value,
          order,
          yyyymmdd,
          ddmmyyyy,
          hhColonMm,
        }),
      )
      preview.push({
        protocol,
        qualiumCode: det.qualiumCode,
        labwinCode,
        decimals,
        rawResult: det.rawResult,
        normalizedResult: normalized.value,
        status: 'mapped',
        lineNumber: det.lineNumber,
      })
      order += 1
      convertedCount += 1
    }
  }

  const filename = `qualium_labwin_${yyyymmdd}_${hhmm}.bid`
  const bidText = `${lines.join('\n')}\n`

  return { bidText, filename, issues, preview, unmapped, convertedCount }
}
