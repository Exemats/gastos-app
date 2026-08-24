'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { plata, nombreMes, fechaCorta, hoyISO, mesShift } from '@/lib/format'
import type { Movimiento, Profile } from '@/lib/types'
import Nav from '@/components/Nav'
import EditarMovimiento from '@/components/EditarMovimiento'
import { useRealtime } from '@/lib/use-realtime'

/**
 * Sección privada: tus gastos personales. No se dividen, no tocan el
 * saldo y la otra persona no los ve (lo garantiza RLS en la base,
 * no solo esta pantalla).
 */
export default function PersonalPage() {
  const supabase = createClient()
  const [movs, setMovs] = useState<Movimiento[]>([])
  const [perfiles, setPerfiles] = useState<Profile[]>([])
  const [userId, setUserId] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const [faltaMigracion, setFaltaMigracion] = useState(false)
  const [mes, setMes] = useState(hoyISO().slice(0, 7))
  const [borrando, setBorrando] = useState<string | null>(null)
  const [editando, setEditando] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    const [{ data: u }, { data, error }, { data: p }] = await Promise.all([
      supabase.auth.getUser(),
      supabase
        .from('movimientos')
        .select('*')
        .eq('es_personal', true)
        .order('fecha', { ascending: false })
        .order('created_at', { ascending: false }),
      supabase.from('profiles').select('id, nombre, porcentaje'),
    ])
    setUserId(u.user?.id ?? null)
    // si es_personal no existe todavía, la migración v2 no se corrió
    setFaltaMigracion(Boolean(error))
    // RLS ya filtra a los tuyos; el filter de abajo es cinturón y tiradores
    setMovs(((data ?? []) as Movimiento[]).filter((m) => m.pagado_por === u.user?.id))
    setPerfiles((p ?? []).map((x) => ({ ...x, porcentaje: Number(x.porcentaje) })))
    setCargando(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    cargar()
  }, [cargar])
  useRealtime(cargar)

  const movsMes = useMemo(() => movs.filter((m) => m.fecha.startsWith(mes)), [movs, mes])
  const total = movsMes.reduce((a, m) => a + Number(m.monto), 0)

  const porCategoria = useMemo(() => {
    const acc = new Map<string, number>()
    for (const m of movsMes) {
      acc.set(m.categoria ?? 'sin categoría', (acc.get(m.categoria ?? 'sin categoría') ?? 0) + Number(m.monto))
    }
    return [...acc.entries()].sort((a, b) => b[1] - a[1])
  }, [movsMes])

  async function borrar(id: string) {
    const { error } = await supabase.from('movimientos').delete().eq('id', id)
    setBorrando(null)
    if (!error) cargar()
  }

  const esMesActual = mes === hoyISO().slice(0, 7)

  return (
    <main className="mx-auto max-w-md px-4 pb-28 pt-6 lg:max-w-2xl">
      <h1 className="text-2xl">Lo tuyo 🔒</h1>
      <p className="mb-4 mt-1 text-sm text-tinta-suave">
        Gastos personales: no se dividen, no tocan el saldo y solo vos los ves.
      </p>

      {faltaMigracion && (
        <div className="card mb-4 border-rojo bg-rojo-suave p-4 text-sm">
          <p className="font-semibold text-rojo">Esta sección necesita la migración</p>
          <p className="mt-1">
            En Supabase → SQL Editor, pegá{' '}
            <span className="font-mono text-xs">docs/migracion_v2.sql</span> y dale Run.
          </p>
        </div>
      )}

      {/* Navegación de mes */}
      <div className="card mb-4 flex items-center justify-between px-2 py-2">
        <button
          className="rounded-lg px-3 py-1 text-xl text-birome"
          aria-label="Mes anterior"
          onClick={() => setMes(mesShift(mes, -1))}
        >
          ‹
        </button>
        <p className="font-semibold capitalize">{nombreMes(mes)}</p>
        <button
          className={`rounded-lg px-3 py-1 text-xl ${esMesActual ? 'text-linea' : 'text-birome'}`}
          aria-label="Mes siguiente"
          disabled={esMesActual}
          onClick={() => setMes(mesShift(mes, 1))}
        >
          ›
        </button>
      </div>

      <section className="card renglones mb-4 p-5">
        <p className="text-sm font-medium text-tinta-suave">Gastaste este mes</p>
        <p className="num mt-1 text-4xl font-semibold">{plata(total)}</p>
        <p className="mt-0.5 text-sm text-tinta-suave">
          {movsMes.length} gasto{movsMes.length === 1 ? '' : 's'}
        </p>
      </section>

      <Link href="/nuevo?ambito=personal" className="btn btn-primario mb-4 w-full">
        + Cargar gasto personal
      </Link>

      {porCategoria.length > 1 && (
        <section className="card mb-4 p-4">
          <h2 className="mb-2 text-lg">Por categoría</h2>
          <ul className="grid gap-1.5">
            {porCategoria.map(([cat, monto]) => (
              <li key={cat} className="flex items-baseline justify-between text-sm">
                <span className="capitalize">{cat}</span>
                <span className="num font-medium">{plata(monto)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {cargando ? (
        <p className="text-sm text-tinta-suave">Cargando…</p>
      ) : movsMes.length === 0 ? (
        <div className="card p-5 text-center text-sm text-tinta-suave">
          Nada anotado este mes. Lo que cargues acá queda solo para tus ojos.
        </div>
      ) : (
        <ul className="card divide-y divide-linea">
          {movsMes.map((m) => (
            <li key={m.id} className="px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{m.descripcion}</p>
                  <p className="text-xs text-tinta-suave">
                    {fechaCorta(m.fecha)}
                    {m.categoria ? ` · ${m.categoria}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <p className="num font-semibold">{plata(Number(m.monto))}</p>
                  {borrando === m.id ? (
                    <span className="flex gap-1">
                      <button
                        className="rounded bg-rojo px-2 py-1 text-xs font-semibold text-white"
                        onClick={() => borrar(m.id)}
                      >
                        Borrar
                      </button>
                      <button
                        className="rounded border border-linea px-2 py-1 text-xs"
                        onClick={() => setBorrando(null)}
                      >
                        No
                      </button>
                    </span>
                  ) : (
                    <>
                      <button
                        className="p-1 text-tinta-suave hover:text-birome"
                        aria-label={`Corregir ${m.descripcion}`}
                        onClick={() => {
                          setEditando(editando === m.id ? null : m.id)
                          setBorrando(null)
                        }}
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
                      </button>
                      <button
                        className="p-1 text-tinta-suave hover:text-rojo"
                        aria-label={`Borrar ${m.descripcion}`}
                        onClick={() => {
                          setBorrando(m.id)
                          setEditando(null)
                        }}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14"/></svg>
                      </button>
                    </>
                  )}
                </div>
              </div>
              {editando === m.id && (
                <div className="mt-2">
                  <EditarMovimiento
                    mov={m}
                    perfiles={perfiles}
                    userId={userId}
                    onDone={() => {
                      setEditando(null)
                      cargar()
                    }}
                    onCancel={() => setEditando(null)}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <Nav />
    </main>
  )
}
