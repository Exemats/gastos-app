'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { plata, nombreMes, fechaCorta } from '@/lib/format'
import type { Movimiento, Profile } from '@/lib/types'
import Nav from '@/components/Nav'

export default function Historial() {
  const supabase = createClient()
  const [movs, setMovs] = useState<Movimiento[]>([])
  const [perfiles, setPerfiles] = useState<Profile[]>([])
  const [cargando, setCargando] = useState(true)

  const [mes, setMes] = useState<string>('todos')
  const [tipo, setTipo] = useState<string>('todos')
  const [persona, setPersona] = useState<string>('todos')
  const [borrando, setBorrando] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    const [{ data: m }, { data: p }] = await Promise.all([
      supabase
        .from('movimientos')
        .select('*')
        .order('fecha', { ascending: false })
        .order('created_at', { ascending: false }),
      supabase.from('profiles').select('id, nombre, porcentaje'),
    ])
    setMovs((m ?? []) as Movimiento[])
    setPerfiles((p ?? []).map((x) => ({ ...x, porcentaje: Number(x.porcentaje) })))
    setCargando(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    cargar()
  }, [cargar])

  const meses = useMemo(() => {
    const set = new Set(movs.map((m) => m.fecha.slice(0, 7)))
    return Array.from(set).sort().reverse()
  }, [movs])

  const filtrados = movs.filter(
    (m) =>
      (mes === 'todos' || m.fecha.startsWith(mes)) &&
      (tipo === 'todos' || m.tipo === tipo) &&
      (persona === 'todos' || m.pagado_por === persona)
  )

  const total = filtrados
    .filter((m) => m.categoria !== 'ajuste')
    .reduce((acc, m) => acc + Number(m.monto), 0)

  async function borrar(id: string) {
    const { error } = await supabase.from('movimientos').delete().eq('id', id)
    setBorrando(null)
    if (!error) cargar()
  }

  const nombreDe = (id: string) => perfiles.find((p) => p.id === id)?.nombre ?? '—'

  return (
    <main className="mx-auto max-w-md px-4 pb-28 pt-6">
      <h1 className="mb-4 text-2xl">Historial</h1>

      <div className="mb-3 grid grid-cols-3 gap-2">
        <select className="input !px-2 !text-sm" value={mes} onChange={(e) => setMes(e.target.value)}>
          <option value="todos">Todos los meses</option>
          {meses.map((m) => (
            <option key={m} value={m}>
              {nombreMes(m)}
            </option>
          ))}
        </select>
        <select className="input !px-2 !text-sm" value={tipo} onChange={(e) => setTipo(e.target.value)}>
          <option value="todos">Todo tipo</option>
          <option value="gasto_depto">Depto</option>
          <option value="gasto_fijo">Fijos</option>
        </select>
        <select className="input !px-2 !text-sm" value={persona} onChange={(e) => setPersona(e.target.value)}>
          <option value="todos">Ambos</option>
          {perfiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nombre}
            </option>
          ))}
        </select>
      </div>

      <div className="card mb-3 flex items-baseline justify-between px-4 py-3">
        <p className="text-sm text-tinta-suave">
          {filtrados.length} movimiento{filtrados.length === 1 ? '' : 's'}
        </p>
        <p className="num text-lg font-semibold">{plata(total)}</p>
      </div>

      {cargando ? (
        <p className="text-sm text-tinta-suave">Cargando…</p>
      ) : filtrados.length === 0 ? (
        <div className="card p-5 text-center text-sm text-tinta-suave">
          Nada por acá con esos filtros.
        </div>
      ) : (
        <ul className="card divide-y divide-linea">
          {filtrados.map((m) => (
            <li key={m.id} className="px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {m.descripcion}
                    {m.prop_pagador === 1 && (
                      <span className="ml-1 text-xs text-tinta-suave">(propio)</span>
                    )}
                    {m.categoria === 'ajuste' && (
                      <span className="ml-1 text-xs text-verde">(saldo)</span>
                    )}
                  </p>
                  <p className="text-xs text-tinta-suave">
                    {fechaCorta(m.fecha)} · {nombreDe(m.pagado_por)} ·{' '}
                    {m.tipo === 'gasto_fijo' ? 'fijo' : m.categoria ?? 'depto'}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <p className="num font-semibold">{plata(Number(m.monto))}</p>
                  {borrando === m.id ? (
                    <span className="flex gap-1">
                      <button className="rounded bg-rojo px-2 py-1 text-xs font-semibold text-white" onClick={() => borrar(m.id)}>
                        Borrar
                      </button>
                      <button className="rounded border border-linea px-2 py-1 text-xs" onClick={() => setBorrando(null)}>
                        No
                      </button>
                    </span>
                  ) : (
                    <button
                      className="p-1 text-tinta-suave"
                      aria-label={`Borrar ${m.descripcion}`}
                      onClick={() => setBorrando(m.id)}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14"/></svg>
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Nav />
    </main>
  )
}
