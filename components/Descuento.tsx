'use client'
import { parsearMonto } from '@/lib/parsear-gasto'
import { montoDescuento } from '@/lib/descuento'
import { plata } from '@/lib/format'

/**
 * Cálculo del descuento a partir de lo tipeado. null = no computable
 * (sin bruto o sin % válido): el caller decide si es error o no-op.
 */
export function calcularDescuento(bruto: number, pctStr: string, topeStr: string) {
  const pct = Number(pctStr.trim().replace('%', '').replace(',', '.'))
  if (!bruto || bruto <= 0 || !Number.isFinite(pct) || pct <= 0 || pct > 100) return null
  const tope = topeStr.trim() ? parsearMonto(topeStr.trim()) : null
  const descuento = montoDescuento(bruto, pct, tope)
  return {
    descuento,
    neto: Math.round((bruto - descuento) * 100) / 100,
    conTope: tope != null && (bruto * pct) / 100 > tope,
  }
}

/**
 * Bloque "¿Tuvo descuento?" para los formularios (gasto, deuda, edición).
 * Un check simple; recién al marcarlo aparecen % y tope de reintegro.
 * El monto que se guarda es siempre el NETO.
 */
export default function Descuento({
  activo,
  onActivo,
  pct,
  onPct,
  tope,
  onTope,
  bruto,
}: {
  activo: boolean
  onActivo: (v: boolean) => void
  pct: string
  onPct: (v: string) => void
  tope: string
  onTope: (v: string) => void
  /** Monto bruto ya parseado, para mostrar el neto en vivo. */
  bruto: number
}) {
  const calc = activo ? calcularDescuento(bruto, pct, tope) : null
  return (
    <div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={activo}
          onChange={(e) => onActivo(e.target.checked)}
        />
        <span>
          Tuvo descuento{' '}
          <span className="text-tinta-suave">(promo banco/billetera)</span>
        </span>
      </label>
      {activo && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block text-xs font-medium" htmlFor="desc-pct">
              % de descuento
            </label>
            <input
              id="desc-pct"
              className="input num !py-2"
              inputMode="decimal"
              placeholder="30"
              value={pct}
              onChange={(e) => onPct(e.target.value.replace(/[^\d.,]/g, ''))}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium" htmlFor="desc-tope">
              Tope de reintegro <span className="text-tinta-suave">(si hay)</span>
            </label>
            <input
              id="desc-tope"
              className="input num !py-2"
              inputMode="decimal"
              placeholder="Sin tope"
              value={tope}
              onChange={(e) => onTope(e.target.value.replace(/[^\d.,]/g, ''))}
            />
          </div>
          {calc && (
            <p className="col-span-2 text-xs text-tinta-suave">
              Descuento −{plata(calc.descuento)}
              {calc.conTope ? ' (recortado por el tope)' : ''} → se anota el neto:{' '}
              <span className="num font-semibold text-tinta">{plata(calc.neto)}</span>
            </p>
          )}
        </div>
      )}
    </div>
  )
}
