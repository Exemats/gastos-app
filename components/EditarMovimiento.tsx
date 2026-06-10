'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { CATEGORIAS, type Movimiento, type Profile } from '@/lib/types'
import { parsearMonto } from '@/lib/parsear-gasto'
import { errorLegible } from '@/lib/errores'

type Division = 'partes' | 'mitad' | 'pagador' | 'custom'

function divisionDe(m: Movimiento): Division {
  if (m.prop_pagador == null) return 'partes'
  const p = Number(m.prop_pagador)
  if (p === 0.5) return 'mitad'
  if (p === 1) return 'pagador'
  return 'custom'
}

/**
 * Corrección manual de un movimiento, inline en el Resumen:
 * descripción, monto, fecha, categoría, quién pagó y cómo se divide.
 */
export default function EditarMovimiento({
  mov,
  perfiles,
  userId,
  onDone,
  onCancel,
}: {
  mov: Movimiento
  perfiles: Profile[]
  userId: string | null
  onDone: () => void
  onCancel: () => void
}) {
  const supabase = createClient()
  const [descripcion, setDescripcion] = useState(mov.descripcion)
  const [monto, setMonto] = useState(String(mov.monto))
  const [fecha, setFecha] = useState(mov.fecha.slice(0, 10))
  const [categoria, setCategoria] = useState(mov.categoria ?? '')
  const [pagadoPor, setPagadoPor] = useState(mov.pagado_por)
  const [division, setDivision] = useState<Division>(divisionDe(mov))
  const [personal, setPersonal] = useState(Boolean(mov.es_personal))
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  const etiquetaPartes =
    perfiles.length === 2
      ? `${Math.round(perfiles[0].porcentaje * 100)}/${Math.round(perfiles[1].porcentaje * 100)}`
      : 'según sus partes'

  // las categorías canónicas + la que ya tenga (ej 'ajuste')
  const categorias: string[] = [...CATEGORIAS]
  if (mov.categoria && !categorias.includes(mov.categoria)) categorias.push(mov.categoria)

  const puedeSerPersonal = pagadoPor === userId || personal

  async function guardar() {
    setError('')
    const montoNum = parsearMonto(monto.trim())
    if (!montoNum || montoNum <= 0) return setError('Poné un monto mayor a cero.')
    if (!descripcion.trim()) return setError('Falta la descripción.')
    if (!fecha) return setError('Falta la fecha.')

    const prop = personal
      ? 1
      : division === 'partes'
        ? null
        : division === 'mitad'
          ? 0.5
          : division === 'pagador'
            ? 1
            : mov.prop_pagador // custom: se conserva el valor original

    setGuardando(true)
    const { error } = await supabase
      .from('movimientos')
      .update({
        descripcion: descripcion.trim(),
        monto: montoNum,
        fecha,
        categoria: categoria || null,
        pagado_por: personal ? userId : pagadoPor,
        prop_pagador: prop,
        // es_personal viaja solo si cambió (compatible con la base sin migrar)
        ...(personal !== Boolean(mov.es_personal) ? { es_personal: personal } : {}),
      })
      .eq('id', mov.id)
    setGuardando(false)
    if (error) {
      setError(errorLegible(error.message))
      return
    }
    onDone()
  }

  return (
    <div className="grid gap-3 rounded-lg border border-birome bg-birome-suave/50 p-3 text-sm">
      <div>
        <label className="mb-1 block text-xs font-medium">Descripción</label>
        <input
          className="input !py-2"
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-xs font-medium">Monto</label>
          <input
            className="input num !py-2"
            inputMode="decimal"
            value={monto}
            onChange={(e) => setMonto(e.target.value.replace(/[^\d.,]/g, ''))}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium">Fecha</label>
          <input
            type="date"
            className="input !py-2"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-xs font-medium">Categoría</label>
          <select
            className="input !py-2"
            value={categoria}
            onChange={(e) => setCategoria(e.target.value)}
          >
            <option value="">sin categoría</option>
            {categorias.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium">¿Quién pagó?</label>
          <select
            className="input !py-2"
            value={pagadoPor}
            disabled={personal}
            onChange={(e) => setPagadoPor(e.target.value)}
          >
            {perfiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
                {p.id === userId ? ' (vos)' : ''}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium">División</label>
        <select
          className="input !py-2"
          value={division}
          disabled={personal}
          onChange={(e) => setDivision(e.target.value as Division)}
        >
          <option value="partes">Según sus partes ({etiquetaPartes})</option>
          <option value="mitad">Mitad y mitad</option>
          <option value="pagador">100% de quien pagó</option>
          {division === 'custom' && (
            <option value="custom">
              Actual ({Math.round(Number(mov.prop_pagador ?? 0) * 100)}% del pagador)
            </option>
          )}
        </select>
      </div>
      {puedeSerPersonal && (
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={personal}
            onChange={(e) => setPersonal(e.target.checked)}
          />
          <span>Personal 🔒 (no se divide, solo lo ves vos)</span>
        </label>
      )}
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
