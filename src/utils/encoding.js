export function decodeQualiumArrayBuffer(arrayBuffer) {
  // Prefer strict UTF-8; if it fails, fall back to legacy encodings.
  const tryDecoders = [
    { label: 'utf-8', decoder: () => new TextDecoder('utf-8', { fatal: true }) },
    { label: 'windows-1252', decoder: () => new TextDecoder('windows-1252') },
    { label: 'iso-8859-1', decoder: () => new TextDecoder('iso-8859-1') },
    { label: 'latin1', decoder: () => new TextDecoder('latin1') },
    { label: 'utf-8 (lossy)', decoder: () => new TextDecoder('utf-8') },
  ]

  for (const d of tryDecoders) {
    try {
      const text = d.decoder().decode(arrayBuffer)
      return { text, encoding: d.label }
    } catch {
      // continue
    }
  }

  return { text: '', encoding: 'unknown' }
}

export function encodeLatin1(text) {
  const s = String(text ?? '')
  const bytes = new Uint8Array(s.length)
  let replacedCount = 0

  for (let i = 0; i < s.length; i += 1) {
    const code = s.charCodeAt(i)
    if (code <= 0xff) {
      bytes[i] = code
    } else {
      bytes[i] = 0x3f // '?'
      replacedCount += 1
    }
  }

  return { bytes, replacedCount }
}

