import qrcode from 'qrcode-generator'
import { useMemo } from 'react'

/** QR Code gerado localmente (sem serviço externo), em SVG com as cores oficiais. */
export function QrCode({ value, label }: { value: string; label: string }) {
  const { size, path } = useMemo(() => {
    const qr = qrcode(0, 'M')
    qr.addData(value)
    qr.make()
    const count = qr.getModuleCount()
    let d = ''
    for (let row = 0; row < count; row += 1) {
      for (let col = 0; col < count; col += 1) {
        if (qr.isDark(row, col)) d += `M${col + 4} ${row + 4}h1v1h-1z`
      }
    }
    return { size: count + 8, path: d }
  }, [value])
  return (
    <svg className="iplex-qr" viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect width={size} height={size} fill="#FFFFFF" />
      <path d={path} fill="#0F0F0F" />
    </svg>
  )
}
