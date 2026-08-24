'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { CATEGORIAS, type Movimiento, type Profile } from '@/lib/types'
import { etiquetaPartes } from '@/lib/format'
import { parsearMonto } from '@/lib/parsear-gasto'
import { errorLegible } from '@/lib/errores'
import Descuento, { calcularDescuento } from '@/components/Descuento'

type Division = 'partes' | 'mitad' | 'pagador' | 'custom'

/**
 * A qué división corresponde el % guardado. Antes "sus partes" se
 * guardaba como null (se resolvía contra el % actual del perfil al
 * leer); ahora se guarda ya resuelto, así que también cuenta como
 * "partes" si coincide con el % del perfil de quien pagó.
 */
function divisionDe(m: Movimiento, perfiles: Profile[]): Division {
  if (m.prop_pagador == null) return 'partes'
  const p = Number(m.prop_pagador)
  const propDePerfil = perfiles.find((x) => x.id === m.pagado_por)?.porcentaje
  if (propDePerfil != null && p === Number(propDePerfil)) return 'partes'
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
  const [division, setDivision] = useState<Division>(divisionDe(mov, perfiles))
  const [personal, setPersonal] = useState(Boolean(mov.es_personal))
  // descuento ex-post: se olvidaron al cargar y lo aplican acá (queda el neto)
  const [conDescuento, setConDescuento] = useState(false)
  const [descuentoPct, setDescuentoPct] = useState('')
  const [topeReintegro, setTopeReintegro] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  // plata entre ustedes: no es un gasto, no tiene categoría ni división
  // propia (cuenta 100% a favor de quien la puso) — solo se corrigen
  // descripción, monto, fecha y quién puso la plata
  const esPrestamo = Boolean(mov.es_prestamo)

  // las categorías canónicas + la que ya tenga
  const categorias: string[] = [...CATEGORIAS]
  if (mov.categoria && !categorias.includes(mov.categoria)) categorias.push(mov.categoria)

  const puedeSerPersonal = !esPrestamo && (pagadoPor === userId || personal)

  async function guardar() {
    setError('')
    let montoNum = parsearMonto(monto.trim())
    if (!montoNum || montoNum <= 0) return setError('Poné un monto mayor a cero.')
    if (conDescuento) {
      const d = calcularDescuento(montoNum, descuentoPct, topeReintegro)
      if (!d) return setError('Poné el % de descuento (o destildá el descuento).')
      montoNum = d.neto
    }
    if (!descripcion.trim()) return setError('Falta la descripción.')
    if (!fecha) return setError('Falta la fecha.')
    if (!esPrestamo && !categoria) return setError('Elegí una categoría — si ninguna pega, está «otros».')

    // "según sus partes" congela el % del pagador ahora mismo (no null):
    // así el movimiento queda auditable aunque el % del perfil cambie después
    const quienPaga = personal ? userId : pagadoPor
    const propDePerfil = perfiles.find((p) => p.id === quienPaga)?.porcentaje ?? 0.5
    const prop = esPrestamo
      ? 0
      : personal
        ? 1
        : division === 'partes'
          ? propDePerfil
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
        categoria: esPrestamo ? null : categoria || null,
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
      {/* descuento ex-post: aplica % y tope sobre el monto de arriba */}
      <Descuento
        activo={conDescuento}
        onActivo={setConDescuento}
        pct={descuentoPct}
        onPct={setDescuentoPct}
        tope={topeReintegro}
        onTope={setTopeReintegro}
        bruto={parsearMonto(monto.trim()) ?? 0}
      />
      <div className="grid grid-cols-2 gap-2">
        {!esPrestamo && (
          <div>
            <label className="mb-1 block text-xs font-medium">Categoría</label>
            <select
              className="input !py-2"
              value={categoria}
              onChange={(e) => setCategoria(e.target.value)}
            >
              {/* los viejos sin categoría arrancan acá y eligen una al guardar */}
              <option value="" disabled>
                elegí una…
              </option>
              {categorias.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className={esPrestamo ? 'col-span-2' : ''}>
          <label className="mb-1 block text-xs font-medium">
            {esPrestamo ? '¿Quién puso la plata?' : '¿Quién pagó?'}
          </label>
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
      {esPrestamo ? (
        <p className="text-xs text-tinta-suave">
          Plata entre ustedes: no es un gasto, cuenta 100% a favor de quien la puso.
        </p>
      ) : (
        <div>
          <label className="mb-1 block text-xs font-medium">División</label>
          <select
            className="input !py-2"
            value={division}
            disabled={personal}
            onChange={(e) => setDivision(e.target.value as Division)}
          >
            <option value="partes">Según sus partes ({etiquetaPartes(perfiles)})</option>
            <option value="mitad">50/50</option>
            <option value="pagador">100% de quien pagó</option>
            {division === 'custom' && (
              <option value="custom">
                Actual ({Math.round(Number(mov.prop_pagador ?? 0) * 100)}% del pagador)
              </option>
            )}
          </select>
        </div>
      )}
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
