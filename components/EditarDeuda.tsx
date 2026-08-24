'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Deuda, Profile } from '@/lib/types'
import { parsearMonto } from '@/lib/parsear-gasto'
import { errorLegible } from '@/lib/errores'

/**
 * Corrección manual de una deuda/cuota, inline en /deudas: descripción,
 * monto total, cantidad de cuotas, cuota actual, fecha y el nombre del
 * tercero (si aplica). No cambia si es "debemos"/"nos deben" ni
 * interno/externo — para eso conviene borrar y cargar de nuevo.
 */
export default function EditarDeuda({
  deuda,
  perfiles,
  onDone,
  onCancel,
}: {
  deuda: Deuda
  perfiles: Profile[]
  onDone: () => void
  onCancel: () => void
}) {
  const supabase = createClient()
  const [descripcion, setDescripcion] = useState(deuda.descripcion)
  const [montoTotal, setMontoTotal] = useState(String(deuda.monto_total))
  const [cuotas, setCuotas] = useState(String(deuda.cantidad_cuotas))
  const [cuotaActual, setCuotaActual] = useState(String(deuda.cuota_actual))
  const [fecha, setFecha] = useState(deuda.fecha_primera_cuota?.slice(0, 10) ?? '')
  const deudorTipo = deuda.deudor_tipo ?? 'interno'
  const ladoTercero: 'acreedor' | 'deudor' | null =
    deuda.acreedor_tipo === 'externo' ? 'acreedor' : deudorTipo === 'externo' ? 'deudor' : null
  const [nombreTercero, setNombreTercero] = useState(
    ladoTercero === 'acreedor'
      ? (deuda.acreedor_nombre ?? '')
      : ladoTercero === 'deudor'
        ? (deuda.deudor_nombre ?? '')
        : ''
  )
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  const nombreDe = (id: string | null) => perfiles.find((p) => p.id === id)?.nombre ?? '—'

  async function guardar() {
    setError('')
    const monto = parsearMonto(montoTotal.trim())
    if (!monto || monto <= 0) return setError('Poné un monto mayor a cero.')
    const n = parseInt(cuotas, 10)
    if (!n || n < 1) return setError('Poné la cantidad de cuotas.')
    const actual = parseInt(cuotaActual, 10) || 0
    if (actual < 0 || actual > n) return setError('La cuota actual tiene que estar entre 0 y el total de cuotas.')
    if (!descripcion.trim()) return setError('Falta la descripción.')
    if (ladoTercero && !nombreTercero.trim())
      return setError('Falta el nombre de quién debe/a quién se debe.')

    const datos: Record<string, unknown> = {
      descripcion: descripcion.trim(),
      monto_total: monto,
      cantidad_cuotas: n,
      cuota_actual: actual,
      activa: actual < n,
      fecha_primera_cuota: fecha || null,
    }
    if (ladoTercero === 'acreedor') datos.acreedor_nombre = nombreTercero.trim()
    if (ladoTercero === 'deudor') datos.deudor_nombre = nombreTercero.trim()

    setGuardando(true)
    const { error } = await supabase.from('deudas').update(datos).eq('id', deuda.id)
    setGuardando(false)
    if (error) return setError(errorLegible(error.message))
    onDone()
  }

  return (
    <div className="mt-2 grid gap-3 rounded-lg border border-birome bg-birome-suave/50 p-3 text-sm">
      <div>
        <label className="mb-1 block text-xs font-medium">Descripción</label>
        <input
          className="input !py-2"
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
        />
      </div>

      {ladoTercero ? (
        <div>
          <label className="mb-1 block text-xs font-medium">
            {ladoTercero === 'acreedor' ? '¿A quién se le debe?' : '¿Quién debe?'}
          </label>
          <input
            className="input !py-2"
            value={nombreTercero}
            onChange={(e) => setNombreTercero(e.target.value)}
          />
        </div>
      ) : (
        <p className="text-xs text-tinta-suave">
          Entre ustedes: {nombreDe(deuda.deudor)} le debe a {nombreDe(deuda.acreedor_profile)}.
        </p>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-xs font-medium">Monto total</label>
          <input
            className="input num !py-2"
            inputMode="decimal"
            value={montoTotal}
            onChange={(e) => setMontoTotal(e.target.value.replace(/[^\d.,]/g, ''))}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium">N° de cuotas</label>
          <input
            className="input num !py-2"
            inputMode="numeric"
            value={cuotas}
            onChange={(e) => setCuotas(e.target.value.replace(/\D/g, ''))}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-xs font-medium">Cuota actual (pagas)</label>
          <input
            className="input num !py-2"
            inputMode="numeric"
            value={cuotaActual}
            onChange={(e) => setCuotaActual(e.target.value.replace(/\D/g, ''))}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium">Primera cuota</label>
          <input
            type="date"
            className="input !py-2"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
          />
        </div>
      </div>

      <div className="flex gap-2">
        <button
          className="btn btn-primario !py-2 !text-sm"
          disabled={guardando}
          onClick={guardar}
        >
          {guardando ? 'Guardando…' : 'Guardar'}
        </button>
        <button className="btn btn-secundario !py-2 !text-sm" onClick={onCancel}>
          Cancelar
        </button>
      </div>
      {error && <p className="text-xs text-rojo">{error}</p>}
    </div>
  )
}
