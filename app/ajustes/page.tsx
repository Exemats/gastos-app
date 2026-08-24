'use client'
import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { plata } from '@/lib/format'
import { parsearMonto } from '@/lib/parsear-gasto'
import { errorLegible } from '@/lib/errores'
import type { GastoFijo, Profile } from '@/lib/types'
import Nav from '@/components/Nav'
import { useRealtime } from '@/lib/use-realtime'

/**
 * Ajustes de la casa: cosas que hasta ahora solo se cambiaban por SQL
 * directo en Supabase. Dos secciones, sin migración nueva: el % de
 * reparto (profiles.porcentaje) y el catálogo de servicios fijos
 * (gastos_fijos), con alta/baja/edición completa desde la app.
 */
export default function AjustesPage() {
  const supabase = createClient()
  const [perfiles, setPerfiles] = useState<Profile[]>([])
  const [fijos, setFijos] = useState<GastoFijo[]>([])
  const [cargando, setCargando] = useState(true)
  const [verInactivos, setVerInactivos] = useState(false)
  const [editandoFijo, setEditandoFijo] = useState<string | null>(null)
  const [creandoFijo, setCreandoFijo] = useState(false)

  const cargar = useCallback(async () => {
    const [{ data: p }, { data: f }] = await Promise.all([
      supabase.from('profiles').select('id, nombre, porcentaje'),
      supabase.from('gastos_fijos').select('*').order('nombre'),
    ])
    setPerfiles((p ?? []).map((x) => ({ ...x, porcentaje: Number(x.porcentaje) })))
    setFijos((f ?? []) as GastoFijo[])
    setCargando(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    cargar()
  }, [cargar])
  useRealtime(cargar)

  const visibles = fijos.filter((f) => verInactivos || f.activo)

  return (
    <main className="mx-auto max-w-md px-4 pb-28 pt-6 lg:max-w-2xl">
      <h1 className="mb-1 text-2xl">Ajustes</h1>
      <p className="mb-4 text-sm text-tinta-suave">
        Lo que antes solo se cambiaba por SQL en Supabase.
      </p>

      {cargando ? (
        <p className="text-sm text-tinta-suave">Cargando…</p>
      ) : (
        <>
          {perfiles.length === 2 && (
            <ReparteEditor perfiles={perfiles} onGuardado={cargar} />
          )}

          <section className="card mb-4 p-4">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-lg">Catálogo de servicios</h2>
              <button
                className="btn btn-primario !py-1.5 !text-sm"
                onClick={() => {
                  setCreandoFijo((v) => !v)
                  setEditandoFijo(null)
                }}
              >
                {creandoFijo ? 'Cerrar' : '+ Nuevo'}
              </button>
            </div>
            <p className="mb-3 text-xs text-tinta-suave">
              Luz, Gas, Expensas… lo que aparece como chip al elegir «servicios» en
              Cargar, con su regla de división.
            </p>

            {creandoFijo && (
              <div className="mb-3">
                <ServicioForm
                  perfiles={perfiles}
                  onGuardado={() => {
                    setCreandoFijo(false)
                    cargar()
                  }}
                  onCancelar={() => setCreandoFijo(false)}
                />
              </div>
            )}

            {visibles.length === 0 ? (
              <p className="text-sm text-tinta-suave">Todavía no hay servicios cargados.</p>
            ) : (
              <ul className="grid gap-2">
                {visibles.map((f) => (
                  <li key={f.id} className={`card p-3 ${f.activo ? '' : 'opacity-60'}`}>
                    <div className="flex items-baseline justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-semibold">
                          {f.nombre}
                          {!f.activo && (
                            <span className="ml-1.5 text-xs font-normal text-tinta-suave">
                              (desactivado)
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-tinta-suave">
                          {f.paga_tercero
                            ? `lo paga ${f.paga_tercero} · debe ${Math.round(Number(f.prop_tercero ?? 0.5) * 100)}%`
                            : Number(f.prop_pagador ?? -1) === 0.5
                              ? 'mitad y mitad'
                              : f.prop_pagador == null
                                ? 'sus partes de siempre'
                                : `${Math.round(Number(f.prop_pagador) * 100)}% de quien carga`}
                          {f.monto_estimado ? ` · ~${plata(Number(f.monto_estimado))}` : ''}
                          {f.dia_vencimiento ? ` · vence el ${f.dia_vencimiento}` : ''}
                        </p>
                      </div>
                      <button
                        className="shrink-0 text-xs text-tinta-suave underline underline-offset-2 hover:text-birome"
                        onClick={() => {
                          setEditandoFijo(editandoFijo === f.id ? null : f.id)
                          setCreandoFijo(false)
                        }}
                      >
                        Corregir
                      </button>
                    </div>
                    {editandoFijo === f.id && (
                      <ServicioForm
                        servicio={f}
                        perfiles={perfiles}
                        onGuardado={() => {
                          setEditandoFijo(null)
                          cargar()
                        }}
                        onCancelar={() => setEditandoFijo(null)}
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
            <button
              className="mt-3 text-xs text-tinta-suave underline underline-offset-2"
              onClick={() => setVerInactivos((v) => !v)}
            >
              {verInactivos ? 'Ocultar desactivados' : 'Ver también los desactivados'}
            </button>
          </section>
        </>
      )}
      <Nav />
    </main>
  )
}

function ReparteEditor({
  perfiles,
  onGuardado,
}: {
  perfiles: Profile[]
  onGuardado: () => void
}) {
  const supabase = createClient()
  const [p1, p2] = perfiles
  const [pct1, setPct1] = useState(String(Math.round(p1.porcentaje * 100)))
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [ok, setOk] = useState(false)

  const n1 = Math.max(0, Math.min(100, parseInt(pct1, 10) || 0))
  const n2 = 100 - n1
  const cambio = n1 !== Math.round(p1.porcentaje * 100)

  async function guardar() {
    setError('')
    setGuardando(true)
    const [{ error: e1 }, { error: e2 }] = await Promise.all([
      supabase.from('profiles').update({ porcentaje: n1 / 100 }).eq('id', p1.id),
      supabase.from('profiles').update({ porcentaje: n2 / 100 }).eq('id', p2.id),
    ])
    setGuardando(false)
    if (e1 || e2) return setError(errorLegible((e1 ?? e2)!.message))
    setOk(true)
    setTimeout(() => setOk(false), 1500)
    onGuardado()
  }

  return (
    <section className="card mb-4 p-4">
      <h2 className="mb-1 text-lg">Reparto entre ustedes</h2>
      <p className="mb-3 text-xs text-tinta-suave">
        El % que le toca a cada uno de los gastos del depto (salvo servicios, que ya se
        dividen mitad y mitad desde el catálogo de abajo).
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium" htmlFor="pct1">
            {p1.nombre}
          </label>
          <div className="relative">
            <input
              id="pct1"
              className="input num !pr-7"
              inputMode="numeric"
              value={pct1}
              onChange={(e) => setPct1(e.target.value.replace(/\D/g, '').slice(0, 3))}
            />
            <span className="num absolute right-3 top-1/2 -translate-y-1/2 text-tinta-suave">
              %
            </span>
          </div>
        </div>
        <div>
          <p className="mb-1 text-xs font-medium">{p2.nombre}</p>
          <p className="input num flex items-center !border-transparent !bg-birome-suave/60 text-tinta-suave">
            {n2}%
          </p>
        </div>
      </div>
      {cambio && (
        <button
          className="btn btn-primario mt-3 !py-2 !text-sm"
          disabled={guardando}
          onClick={guardar}
        >
          {guardando ? 'Guardando…' : ok ? 'Guardado ✓' : 'Guardar reparto'}
        </button>
      )}
      {error && <p className="mt-2 text-xs text-rojo">{error}</p>}
      <p className="mt-2 text-xs text-tinta-suave">
        Ojo: cambia la división de los gastos que se carguen de ahora en más. Los ya
        cargados quedan con el % que se usó en su momento.
      </p>
    </section>
  )
}

type DivisionFijo = 'partes' | 'mitad' | 'custom'

function ServicioForm({
  servicio,
  perfiles,
  onGuardado,
  onCancelar,
}: {
  servicio?: GastoFijo
  perfiles: Profile[]
  onGuardado: () => void
  onCancelar: () => void
}) {
  const supabase = createClient()
  const [nombre, setNombre] = useState(servicio?.nombre ?? '')
  const [montoEstimado, setMontoEstimado] = useState(
    servicio?.monto_estimado ? String(servicio.monto_estimado) : ''
  )
  const [diaVencimiento, setDiaVencimiento] = useState(
    servicio?.dia_vencimiento ? String(servicio.dia_vencimiento) : ''
  )
  const [activo, setActivo] = useState(servicio?.activo ?? true)
  const [division, setDivision] = useState<DivisionFijo>(
    servicio?.prop_pagador == null
      ? 'partes'
      : Number(servicio.prop_pagador) === 0.5
        ? 'mitad'
        : 'custom'
  )
  const [propCustom, setPropCustom] = useState(
    servicio?.prop_pagador != null ? String(Math.round(Number(servicio.prop_pagador) * 100)) : ''
  )
  const [pagaTercero, setPagaTercero] = useState(Boolean(servicio?.paga_tercero))
  const [terceroNombre, setTerceroNombre] = useState(servicio?.paga_tercero ?? '')
  const [propTercero, setPropTercero] = useState(
    servicio?.prop_tercero != null ? String(Math.round(Number(servicio.prop_tercero) * 100)) : '50'
  )
  const [terceroDeudor, setTerceroDeudor] = useState(servicio?.tercero_deudor ?? '')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [borrando, setBorrando] = useState(false)

  async function guardar(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!nombre.trim()) return setError('Falta el nombre.')
    if (pagaTercero && !terceroNombre.trim()) return setError('Falta el nombre de quién lo paga.')

    const datos: Record<string, unknown> = {
      nombre: nombre.trim(),
      monto_estimado: montoEstimado.trim() ? parsearMonto(montoEstimado.trim()) : null,
      dia_vencimiento: diaVencimiento.trim() ? parseInt(diaVencimiento, 10) : null,
      activo,
      prop_pagador: pagaTercero
        ? null
        : division === 'mitad'
          ? 0.5
          : division === 'custom'
            ? Math.max(0, Math.min(100, parseInt(propCustom, 10) || 0)) / 100
            : null,
      paga_tercero: pagaTercero ? terceroNombre.trim() : null,
      prop_tercero: pagaTercero
        ? Math.max(0, Math.min(100, parseInt(propTercero, 10) || 50)) / 100
        : null,
      tercero_deudor: pagaTercero ? terceroDeudor || null : null,
    }

    setGuardando(true)
    const { error } = servicio
      ? await supabase.from('gastos_fijos').update(datos).eq('id', servicio.id)
      : await supabase.from('gastos_fijos').insert(datos)
    setGuardando(false)
    if (error) return setError(errorLegible(error.message))
    onGuardado()
  }

  async function borrar() {
    if (!servicio) return
    setGuardando(true)
    const { error } = await supabase.from('gastos_fijos').delete().eq('id', servicio.id)
    setGuardando(false)
    if (error) return setError(errorLegible(error.message))
    onGuardado()
  }

  return (
    <form
      onSubmit={guardar}
      className="mt-2 grid gap-3 rounded-lg border border-birome bg-birome-suave/50 p-3 text-sm"
    >
      <div>
        <label className="mb-1 block text-xs font-medium">Nombre</label>
        <input
          className="input !py-2"
          placeholder="Luz, Gas, Netflix…"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-xs font-medium">Monto estimado</label>
          <input
            className="input num !py-2"
            inputMode="decimal"
            placeholder="Opcional"
            value={montoEstimado}
            onChange={(e) => setMontoEstimado(e.target.value.replace(/[^\d.,]/g, ''))}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium">Día de vencimiento</label>
          <input
            className="input num !py-2"
            inputMode="numeric"
            placeholder="Opcional, 1-31"
            value={diaVencimiento}
            onChange={(e) => setDiaVencimiento(e.target.value.replace(/\D/g, '').slice(0, 2))}
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={pagaTercero} onChange={(e) => setPagaTercero(e.target.checked)} />
        <span>Lo paga un tercero (ej: Expensas → Seba)</span>
      </label>

      {pagaTercero ? (
        <div className="grid gap-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs font-medium">¿Quién lo paga?</label>
              <input
                className="input !py-2"
                value={terceroNombre}
                onChange={(e) => setTerceroNombre(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">% que se le debe</label>
              <input
                className="input num !py-2"
                inputMode="numeric"
                value={propTercero}
                onChange={(e) => setPropTercero(e.target.value.replace(/\D/g, '').slice(0, 3))}
              />
            </div>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium">¿Quién de los dos le queda debiendo?</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="chip !text-xs"
                data-activo={terceroDeudor === ''}
                onClick={() => setTerceroDeudor('')}
              >
                Quien carga
              </button>
              {perfiles.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="chip !text-xs"
                  data-activo={terceroDeudor === p.id}
                  onClick={() => setTerceroDeudor(p.id)}
                >
                  {p.nombre}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div>
          <p className="mb-1 text-xs font-medium">¿Cómo se divide?</p>
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              className="chip !text-xs text-center"
              data-activo={division === 'partes'}
              onClick={() => setDivision('partes')}
            >
              Sus partes
            </button>
            <button
              type="button"
              className="chip !text-xs text-center"
              data-activo={division === 'mitad'}
              onClick={() => setDivision('mitad')}
            >
              50/50
            </button>
            <button
              type="button"
              className="chip !text-xs text-center"
              data-activo={division === 'custom'}
              onClick={() => setDivision('custom')}
            >
              Puntual
            </button>
          </div>
          {division === 'custom' && (
            <input
              className="input num mt-2 !py-2"
              inputMode="numeric"
              placeholder="% de quien lo carga"
              value={propCustom}
              onChange={(e) => setPropCustom(e.target.value.replace(/\D/g, '').slice(0, 3))}
            />
          )}
        </div>
      )}

      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} />
        <span>Activo (aparece como chip al cargar)</span>
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <button className="btn btn-primario !py-2 !text-sm" disabled={guardando}>
          {guardando ? 'Guardando…' : servicio ? 'Guardar cambios' : 'Crear servicio'}
        </button>
        <button
          type="button"
          className="btn btn-secundario !py-2 !text-sm"
          onClick={onCancelar}
        >
          Cancelar
        </button>
        {servicio && (
          <span className="ml-auto">
            {borrando ? (
              <span className="flex items-center gap-2 text-xs">
                <span>¿Borrar del catálogo?</span>
                <button
                  type="button"
                  className="rounded bg-rojo px-2 py-1 font-semibold text-white"
                  onClick={borrar}
                >
                  Sí
                </button>
                <button
                  type="button"
                  className="rounded border border-linea px-2 py-1"
                  onClick={() => setBorrando(false)}
                >
                  No
                </button>
              </span>
            ) : (
              <button
                type="button"
                className="text-xs text-tinta-suave underline underline-offset-2 hover:text-rojo"
                onClick={() => setBorrando(true)}
              >
                Borrar
              </button>
            )}
          </span>
        )}
      </div>
      {error && <p className="text-xs text-rojo">{error}</p>}
    </form>
  )
}
