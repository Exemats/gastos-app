'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import {
  plata,
  plataExacta,
  nombreMes,
  fechaCorta,
  hoyISO,
  mesShift,
  calcularBalance,
} from '@/lib/format'
import type { Deuda, MesSaldado, Movimiento, Profile } from '@/lib/types'
import Nav from '@/components/Nav'
import TacharMes from '@/components/TacharMes'

type Filtro = 'todos' | 'compartidos' | 'mios'

export default function ResumenPage() {
  const supabase = createClient()
  const [movs, setMovs] = useState<Movimiento[]>([])
  const [deudas, setDeudas] = useState<Deuda[]>([])
  const [perfiles, setPerfiles] = useState<Profile[]>([])
  const [saldados, setSaldados] = useState<MesSaldado[]>([])
  const [hayTachado, setHayTachado] = useState(true) // false si falta la migración
  const [userId, setUserId] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)

  const [mes, setMes] = useState(hoyISO().slice(0, 7))
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [borrando, setBorrando] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    const [{ data: u }, { data: m }, { data: d }, { data: p }, rSaldados] =
      await Promise.all([
        supabase.auth.getUser(),
        supabase
          .from('movimientos')
          .select('*')
          .order('fecha', { ascending: false })
          .order('created_at', { ascending: false }),
        supabase.from('deudas').select('*').eq('activa', true),
        supabase.from('profiles').select('id, nombre, porcentaje'),
        supabase.from('meses_saldados').select('*'),
      ])
    setUserId(u.user?.id ?? null)
    setMovs((m ?? []) as Movimiento[])
    setDeudas((d ?? []) as Deuda[])
    setPerfiles((p ?? []).map((x) => ({ ...x, porcentaje: Number(x.porcentaje) })))
    setSaldados((rSaldados.data ?? []) as MesSaldado[])
    setHayTachado(!rSaldados.error)
    setCargando(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    cargar()
  }, [cargar])

  // --- movimientos del mes elegido ---
  const movsMes = useMemo(() => movs.filter((m) => m.fecha.startsWith(mes)), [movs, mes])
  const compMes = useMemo(
    () => movsMes.filter((m) => !m.es_personal && m.categoria !== 'ajuste'),
    [movsMes]
  )
  const ajustesMes = movsMes.filter((m) => !m.es_personal && m.categoria === 'ajuste')
  // RLS ya esconde los personales del otro: estos son solo los tuyos
  const personalesMes = movsMes.filter((m) => m.es_personal && m.pagado_por === userId)

  const totalComp = compMes.reduce((a, m) => a + Number(m.monto), 0)
  const totalPersonal = personalesMes.reduce((a, m) => a + Number(m.monto), 0)

  // --- lo compartido, persona por persona: pagó / su parte / neto del mes ---
  const porPersona = useMemo(() => {
    const porId = new Map(perfiles.map((p) => [p.id, p]))
    return perfiles.map((p) => {
      let pago = 0
      let suParte = 0
      for (const m of compMes) {
        const monto = Number(m.monto)
        const prop = Number(m.prop_pagador ?? porId.get(m.pagado_por)?.porcentaje ?? 0.5)
        if (m.pagado_por === p.id) {
          pago += monto
          suParte += monto * prop
        } else {
          suParte += monto * (1 - prop)
        }
      }
      return { perfil: p, pago, suParte, neto: pago - suParte }
    })
  }, [perfiles, compMes])

  // --- categorías del mes ---
  const porCategoria = useMemo(() => {
    const acc = new Map<string, number>()
    for (const m of compMes) {
      const c = m.categoria ?? (m.tipo === 'gasto_fijo' ? 'servicios' : 'sin categoría')
      acc.set(c, (acc.get(c) ?? 0) + Number(m.monto))
    }
    return [...acc.entries()].sort((a, b) => b[1] - a[1])
  }, [compMes])
  const maxCategoria = porCategoria[0]?.[1] ?? 1

  // --- deudas activas por persona (estado actual, no depende del mes) ---
  const porDeudor = useMemo(
    () =>
      perfiles
        .map((p) => {
          const mias = deudas.filter((d) => d.deudor === p.id)
          return {
            perfil: p,
            deudas: mias,
            cuotaMensual: mias.reduce((a, d) => a + Number(d.valor_cuota), 0),
            restante: mias.reduce((a, d) => a + Number(d.valor_cuota) * d.cuotas_restantes, 0),
          }
        })
        .filter((x) => x.deudas.length > 0),
    [perfiles, deudas]
  )

  // --- cierre del mes: neto real a transferir (incluye ajustes viejos) ---
  const compartidosMes = useMemo(
    () => movsMes.filter((m) => !m.es_personal),
    [movsMes]
  )
  const cierre = useMemo(() => {
    if (perfiles.length !== 2) return null
    const [p1, p2] = perfiles
    const puso = calcularBalance(compartidosMes, perfiles)
    const diff = (puso.get(p1.id) ?? 0) - (puso.get(p2.id) ?? 0)
    return {
      deudor: diff > 0 ? p2 : p1,
      acreedor: diff > 0 ? p1 : p2,
      monto: Math.abs(diff),
      saldado: saldados.find((s) => s.mes === mes) ?? null,
    }
  }, [perfiles, compartidosMes, saldados, mes])

  async function destachar() {
    const { error } = await supabase.from('meses_saldados').delete().eq('mes', mes)
    if (!error) cargar()
  }

  // --- lista filtrable ---
  const visibles = movsMes.filter((m) =>
    filtro === 'todos' ? true : filtro === 'mios' ? m.es_personal : !m.es_personal
  )
  const totalVisibles = visibles
    .filter((m) => m.categoria !== 'ajuste')
    .reduce((a, m) => a + Number(m.monto), 0)

  async function borrar(id: string) {
    const { error } = await supabase.from('movimientos').delete().eq('id', id)
    setBorrando(null)
    if (!error) cargar()
  }

  const nombreDe = (id: string) => perfiles.find((p) => p.id === id)?.nombre ?? '—'
  const esMesActual = mes === hoyISO().slice(0, 7)

  return (
    <main className="mx-auto max-w-md px-4 pb-28 pt-6">
      <h1 className="mb-3 text-2xl">Resumen</h1>

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

      {cargando ? (
        <p className="text-sm text-tinta-suave">Cargando…</p>
      ) : (
        <>
          {/* Compartido por persona */}
          <section className="card mb-4 p-4">
            <div className="flex items-baseline justify-between">
              <h2 className="text-lg">Compartido</h2>
              <p className="num text-xl font-semibold">{plata(totalComp)}</p>
            </div>
            {compMes.length === 0 ? (
              <p className="mt-2 text-sm text-tinta-suave">Sin gastos compartidos este mes.</p>
            ) : (
              <div className="mt-3 grid gap-2">
                {porPersona.map(({ perfil, pago, suParte, neto }) => (
                  <div key={perfil.id} className="rounded-lg bg-birome-suave/60 p-3">
                    <div className="flex items-baseline justify-between">
                      <p className="font-semibold">
                        {perfil.nombre}
                        {perfil.id === userId ? ' (vos)' : ''}
                      </p>
                      {Math.abs(neto) < 1 ? (
                        <p className="text-sm font-semibold text-verde">a mano ✓</p>
                      ) : neto > 0 ? (
                        <p className="num text-sm font-semibold text-verde">
                          +{plata(neto)} a favor
                        </p>
                      ) : (
                        <p className="num text-sm font-semibold text-rojo">
                          debe {plata(-neto)}
                        </p>
                      )}
                    </div>
                    <p className="mt-0.5 text-sm text-tinta-suave">
                      pagó <span className="num font-medium text-tinta">{plata(pago)}</span> · su
                      parte ({Math.round(perfil.porcentaje * 100)}%){' '}
                      <span className="num font-medium text-tinta">{plata(suParte)}</span>
                    </p>
                  </div>
                ))}
              </div>
            )}
            {ajustesMes.length > 0 && (
              <p className="mt-2 text-xs text-tinta-suave">
                Además hubo {ajustesMes.length} pago{ajustesMes.length === 1 ? '' : 's'} de saldo
                por{' '}
                <span className="num">
                  {plata(ajustesMes.reduce((a, m) => a + Number(m.monto), 0))}
                </span>
                .
              </p>
            )}

            {/* Cierre del mes: a principio del mes siguiente se transfiere y se tacha */}
            {cierre && hayTachado && (compartidosMes.length > 0 || cierre.saldado) && (
              <div className="mt-4 border-t border-linea pt-3 text-sm">
                {cierre.saldado ? (
                  <div className="flex flex-wrap items-baseline justify-between gap-1">
                    <p className="font-semibold text-verde">
                      Saldado ✓{' '}
                      <span className="font-normal text-tinta-suave">
                        el {fechaCorta(cierre.saldado.created_at)}
                        {cierre.saldado.monto != null &&
                          ` · se transfirieron ${plata(Number(cierre.saldado.monto))}`}
                      </span>
                    </p>
                    <button
                      className="text-xs text-tinta-suave underline underline-offset-2"
                      onClick={destachar}
                    >
                      Deshacer
                    </button>
                    {cierre.saldado.monto != null &&
                      Math.abs(Number(cierre.saldado.monto) - cierre.monto) >= 1 && (
                        <p className="w-full text-xs text-rojo">
                          Ojo: después de tachar cambió el mes — ahora el neto da{' '}
                          <span className="num">{plata(cierre.monto)}</span>. Si hace falta,
                          deshacé, ajusten y tachen de nuevo.
                        </p>
                      )}
                  </div>
                ) : cierre.monto < 1 ? (
                  <p className="font-medium text-verde">
                    A mano ✓ — no hay nada que transferir.
                  </p>
                ) : esMesActual ? (
                  <p className="text-tinta-suave">
                    Mes en curso: por ahora{' '}
                    <span className="font-medium text-tinta">
                      {cierre.deudor.nombre} le debe{' '}
                      <span className="num">{plata(cierre.monto)}</span> a{' '}
                      {cierre.acreedor.nombre}
                    </span>
                    . Se transfiere y se tacha a principios del mes que viene.
                  </p>
                ) : (
                  <div className="flex flex-col gap-2">
                    <p>
                      <span className="font-semibold">{cierre.deudor.nombre}</span>
                      {cierre.deudor.id === userId ? ' (vos)' : ''} le tiene que transferir{' '}
                      <span className="num font-semibold">{plata(cierre.monto)}</span> a{' '}
                      <span className="font-semibold">{cierre.acreedor.nombre}</span>.
                    </p>
                    <TacharMes mes={mes} monto={cierre.monto} prominente onDone={cargar} />
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Por categoría */}
          {porCategoria.length > 0 && (
            <section className="card mb-4 p-4">
              <h2 className="mb-3 text-lg">Por categoría</h2>
              <div className="grid gap-2.5">
                {porCategoria.map(([cat, total]) => (
                  <div key={cat}>
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="capitalize">{cat}</span>
                      <span className="num font-medium">{plata(total)}</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-birome-suave">
                      <div
                        className="h-full rounded-full bg-birome"
                        style={{ width: `${Math.max(4, (total / maxCategoria) * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Deudas por persona */}
          <section className="card mb-4 p-4">
            <div className="flex items-baseline justify-between">
              <h2 className="text-lg">Deudas en cuotas</h2>
              <Link href="/deudas" className="text-sm font-medium text-birome">
                Administrar
              </Link>
            </div>
            {porDeudor.length === 0 ? (
              <p className="mt-2 text-sm text-tinta-suave">No hay deudas activas. 🎉</p>
            ) : (
              <div className="mt-3 grid gap-3">
                {porDeudor.map(({ perfil, deudas: lista, cuotaMensual, restante }) => (
                  <div key={perfil.id}>
                    <div className="flex items-baseline justify-between">
                      <p className="font-semibold">
                        {perfil.nombre}
                        {perfil.id === userId ? ' (vos)' : ''}
                      </p>
                      <p className="text-sm text-tinta-suave">
                        <span className="num font-semibold text-tinta">{plata(cuotaMensual)}</span>
                        /mes · faltan <span className="num">{plata(restante)}</span>
                      </p>
                    </div>
                    <ul className="mt-1.5 grid gap-1">
                      {lista.map((d) => (
                        <li
                          key={d.id}
                          className="flex items-baseline justify-between rounded-lg bg-birome-suave/40 px-3 py-1.5 text-sm"
                        >
                          <span className="min-w-0 truncate">
                            {d.descripcion}
                            <span className="text-tinta-suave">
                              {' '}
                              → {d.acreedor_tipo === 'interno'
                                ? nombreDe(d.acreedor_profile ?? '')
                                : d.acreedor_nombre}
                            </span>
                          </span>
                          <span className="num shrink-0 pl-2 text-tinta-suave">
                            {d.cuota_actual}/{d.cantidad_cuotas} ·{' '}
                            {plataExacta(Number(d.valor_cuota))}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Lo personal tuyo */}
          <Link href="/personal" className="card mb-4 flex items-center justify-between p-4">
            <div>
              <p className="font-semibold">Tus gastos personales 🔒</p>
              <p className="text-sm text-tinta-suave">
                {personalesMes.length === 0
                  ? 'Nada anotado este mes'
                  : `${personalesMes.length} este mes — solo vos los ves`}
              </p>
            </div>
            <p className="num text-xl font-semibold">{plata(totalPersonal)}</p>
          </Link>

          {/* Movimientos del mes */}
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-lg">Movimientos</h2>
              <p className="num text-sm font-semibold">{plata(totalVisibles)}</p>
            </div>
            <div className="mb-3 flex gap-2">
              {(
                [
                  ['todos', 'Todos'],
                  ['compartidos', 'Compartidos'],
                  ['mios', 'Míos 🔒'],
                ] as [Filtro, string][]
              ).map(([valor, etiqueta]) => (
                <button
                  key={valor}
                  type="button"
                  className="chip"
                  data-activo={filtro === valor}
                  onClick={() => setFiltro(valor)}
                >
                  {etiqueta}
                </button>
              ))}
            </div>
            {visibles.length === 0 ? (
              <div className="card p-5 text-center text-sm text-tinta-suave">
                Nada por acá este mes.
              </div>
            ) : (
              <ul className="card divide-y divide-linea">
                {visibles.map((m) => (
                  <li key={m.id} className="px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium">
                          {m.descripcion}
                          {m.es_personal && (
                            <span className="ml-1 text-xs text-tinta-suave">🔒</span>
                          )}
                          {!m.es_personal && m.prop_pagador === 1 && (
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
          </section>
        </>
      )}
      <Nav />
    </main>
  )
}
