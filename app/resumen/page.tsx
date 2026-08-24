'use client'
import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import {
  plata,
  plataExacta,
  plataCompacta,
  nombreMes,
  nombreMesCorto,
  fechaCorta,
  hoyISO,
  mesShift,
} from '@/lib/format'
import { sinAcentos, parsearMonto } from '@/lib/parsear-gasto'
import type { Deuda, GastoFijo, MesSaldado, Movimiento, Presupuesto, Profile } from '@/lib/types'
import { serviciosFaltantes } from '@/lib/servicios'
import {
  agruparDeudas,
  deudasQueDebes,
  deudasQueTeDeben,
  etiquetaAcreedor,
  etiquetaDeudor,
  type GrupoDeuda,
} from '@/lib/deudas'
import { calcularAuditoria, etiquetaOrigenProp, origenProp } from '@/lib/auditoria'
import Nav from '@/components/Nav'
import TacharMes from '@/components/TacharMes'
import EditarMovimiento from '@/components/EditarMovimiento'
import { useRealtime } from '@/lib/use-realtime'

type Filtro = 'todos' | 'compartidos' | 'mios'

const COLORES_PERSONA = ['#2d4fa1', '#8aa6e0'] // birome y birome claro

export default function ResumenPage() {
  const supabase = createClient()
  const [movs, setMovs] = useState<Movimiento[]>([])
  const [deudas, setDeudas] = useState<Deuda[]>([])
  const [perfiles, setPerfiles] = useState<Profile[]>([])
  const [saldados, setSaldados] = useState<MesSaldado[]>([])
  const [hayTachado, setHayTachado] = useState(true) // false si falta la migración
  const [presupuestos, setPresupuestos] = useState<Presupuesto[]>([])
  const [hayPresupuestos, setHayPresupuestos] = useState(true)
  const [fijosCatalogo, setFijosCatalogo] = useState<GastoFijo[]>([])
  const [todasLasDeudas, setTodasLasDeudas] = useState<
    Pick<Deuda, 'descripcion' | 'created_at' | 'fecha_primera_cuota'>[]
  >([])
  const [userId, setUserId] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)

  const [mes, setMes] = useState(hoyISO().slice(0, 7))
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [filtroCat, setFiltroCat] = useState('')
  const [filtroPagador, setFiltroPagador] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [borrando, setBorrando] = useState<string | null>(null)
  const [editando, setEditando] = useState<string | null>(null)
  const [copiado, setCopiado] = useState(false)
  const [editandoLimite, setEditandoLimite] = useState<string | null>(null)
  const [limiteInput, setLimiteInput] = useState('')

  const cargar = useCallback(async () => {
    const [{ data: u }, { data: m }, { data: d }, { data: p }, rSaldados, rPres, rFijos, rDeudasTodas] =
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
        supabase.from('presupuestos').select('*'),
        supabase.from('gastos_fijos').select('*').eq('activo', true),
        // todas (no solo activas): una ya saldada igual cuenta como "cargada ese mes"
        supabase.from('deudas').select('descripcion, created_at, fecha_primera_cuota'),
      ])
    setUserId(u.user?.id ?? null)
    setMovs((m ?? []) as Movimiento[])
    setDeudas((d ?? []) as Deuda[])
    setPerfiles((p ?? []).map((x) => ({ ...x, porcentaje: Number(x.porcentaje) })))
    setSaldados((rSaldados.data ?? []) as MesSaldado[])
    setHayTachado(!rSaldados.error)
    setPresupuestos(
      ((rPres.data ?? []) as Presupuesto[]).map((x) => ({ ...x, monto: Number(x.monto) }))
    )
    setHayPresupuestos(!rPres.error)
    setFijosCatalogo((rFijos.data ?? []) as GastoFijo[])
    setTodasLasDeudas(rDeudasTodas.data ?? [])
    setCargando(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    cargar()
  }, [cargar])
  useRealtime(cargar)

  // --- movimientos del mes elegido ---
  const movsMes = useMemo(() => movs.filter((m) => m.fecha.startsWith(mes)), [movs, mes])
  const compMes = useMemo(
    () => movsMes.filter((m) => !m.es_personal && !m.es_prestamo),
    [movsMes]
  )
  const ajustesMes = movsMes.filter((m) => !m.es_personal && m.es_prestamo)
  // RLS ya esconde los personales del otro: estos son solo los tuyos
  const personalesMes = movsMes.filter((m) => m.es_personal && m.pagado_por === userId)

  // --- ¿está todo cargado? antes de confiar en el neto y tacharlo, avisa
  // si algún servicio del catálogo no tiene nada anotado este mes ---
  const faltantesDelMes = useMemo(
    () => serviciosFaltantes(mes, compMes, todasLasDeudas, fijosCatalogo),
    [mes, compMes, todasLasDeudas, fijosCatalogo]
  )

  const totalComp = compMes.reduce((a, m) => a + Number(m.monto), 0)
  const totalPersonal = personalesMes.reduce((a, m) => a + Number(m.monto), 0)

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

  // --- deudas activas, agrupadas igual que en /deudas (estado actual,
  // no depende del mes): lo que debés vos, y lo que te deben a vos ---
  const debes = useMemo(
    () => agruparDeudas(deudasQueDebes(deudas, userId), (d) => etiquetaAcreedor(d, perfiles)),
    [deudas, userId, perfiles]
  )
  const teDeben = useMemo(
    () => agruparDeudas(deudasQueTeDeben(deudas, userId), (d) => etiquetaDeudor(d, perfiles)),
    [deudas, userId, perfiles]
  )

  const esMesActual = mes === hoyISO().slice(0, 7)

  // --- cuotas "entre ustedes": deudas activas tipo 'interno'. Su cuota de
  // este mes es la 3ra fuente de saldo (junto con gastos del depto y
  // préstamos); solo suma al neto del mes EN CURSO porque no está atada
  // a una fecha del mes sino a "cuánto toca pagar ahora" (ver incluyeCuotas
  // en lib/auditoria.ts) ---
  const cuotasInternasActivas = useMemo(
    () =>
      deudas.filter(
        (d) => d.acreedor_tipo === 'interno' && (d.deudor_tipo ?? 'interno') === 'interno'
      ),
    [deudas]
  )

  // --- el desglose auditable del mes: única fuente de verdad de cómo se
  // llega al neto (gastos del depto + préstamos + cuotas entre ustedes) ---
  const auditoria = useMemo(() => {
    if (perfiles.length !== 2) return null
    const [p1, p2] = perfiles
    return calcularAuditoria(compMes, ajustesMes, cuotasInternasActivas, p1, p2, esMesActual)
  }, [perfiles, compMes, ajustesMes, cuotasInternasActivas, esMesActual])

  const cierre = useMemo(() => {
    if (!auditoria) return null
    return {
      deudor: auditoria.deudor,
      acreedor: auditoria.acreedor,
      monto: auditoria.monto,
      saldado: saldados.find((s) => s.mes === mes) ?? null,
    }
  }, [auditoria, saldados, mes])

  // hay algo para desglosar línea por línea (aunque sea una sola fuente)
  const hayDesglose = Boolean(
    auditoria &&
      (compMes.length > 0 || ajustesMes.length > 0 || cuotasInternasActivas.length > 0)
  )

  async function destachar() {
    const { error } = await supabase.from('meses_saldados').delete().eq('mes', mes)
    if (!error) cargar()
  }

  // --- presupuestos por categoría ---
  const limiteDe = (cat: string) =>
    presupuestos.find((p) => p.categoria === cat)?.monto ?? null

  async function guardarLimite(cat: string) {
    const monto = parsearMonto(limiteInput.trim())
    if (monto && monto > 0) {
      await supabase.from('presupuestos').upsert({ categoria: cat, monto }, { onConflict: 'categoria' })
    } else if (!limiteInput.trim()) {
      await supabase.from('presupuestos').delete().eq('categoria', cat)
    }
    setEditandoLimite(null)
    setLimiteInput('')
    cargar()
  }

  // --- evolución: últimos 6 meses, apilado por persona ---
  const evolucion = useMemo(() => {
    const meses = Array.from({ length: 6 }, (_, i) => mesShift(mes, i - 5))
    return meses.map((m) => {
      const delMes = movs.filter(
        (x) => x.fecha.startsWith(m) && !x.es_personal && !x.es_prestamo
      )
      const porPerfil = perfiles.map((p) =>
        delMes
          .filter((x) => x.pagado_por === p.id)
          .reduce((a, x) => a + Number(x.monto), 0)
      )
      return { mes: m, porPerfil, total: porPerfil.reduce((a, b) => a + b, 0) }
    })
  }, [movs, perfiles, mes])
  const maxEvolucion = Math.max(1, ...evolucion.map((e) => e.total))
  const mesAnterior = evolucion[evolucion.length - 2]
  const variacion =
    mesAnterior && mesAnterior.total > 0
      ? ((totalComp - mesAnterior.total) / mesAnterior.total) * 100
      : null

  // --- acumulado del año del mes elegido ---
  const anio = mes.slice(0, 4)
  const anual = useMemo(() => {
    const delAnio = movs.filter(
      (m) => m.fecha.startsWith(anio) && !m.es_personal && !m.es_prestamo
    )
    const total = delAnio.reduce((a, m) => a + Number(m.monto), 0)
    const mesesConDatos = new Set(delAnio.map((m) => m.fecha.slice(0, 7))).size
    return { total, promedio: mesesConDatos > 0 ? total / mesesConDatos : 0 }
  }, [movs, anio])

  // --- lista filtrable + búsqueda ---
  const categoriaDe = (m: Movimiento) =>
    m.es_prestamo
      ? 'plata entre ustedes'
      : m.categoria ?? (m.tipo === 'gasto_fijo' ? 'servicios' : 'sin categoría')

  // categorías presentes en el mes (para el filtro)
  const categoriasDelMes = useMemo(
    () => [...new Set(movsMes.map(categoriaDe))].sort((a, b) => a.localeCompare(b)),
    [movsMes]
  )

  const visibles = useMemo(() => {
    const q = sinAcentos(busqueda.trim())
    return movsMes.filter((m) => {
      if (filtro === 'mios' && !m.es_personal) return false
      if (filtro === 'compartidos' && m.es_personal) return false
      if (filtroCat && categoriaDe(m) !== filtroCat) return false
      if (filtroPagador && m.pagado_por !== filtroPagador) return false
      if (!q) return true
      return (
        sinAcentos(m.descripcion).includes(q) ||
        sinAcentos(m.categoria ?? '').includes(q)
      )
    })
  }, [movsMes, filtro, filtroCat, filtroPagador, busqueda])
  const totalVisibles = visibles
    .filter((m) => !m.es_prestamo)
    .reduce((a, m) => a + Number(m.monto), 0)

  // --- desplegables por categoría (para corregir) ---
  const grupos = useMemo(() => {
    const map = new Map<string, Movimiento[]>()
    for (const m of visibles) {
      const key = m.es_prestamo
        ? 'plata entre ustedes'
        : m.categoria ?? (m.tipo === 'gasto_fijo' ? 'servicios' : 'sin categoría')
      map.set(key, [...(map.get(key) ?? []), m])
    }
    return [...map.entries()]
      .map(([cat, lista]) => ({
        cat,
        lista,
        total: lista.reduce((a, m) => a + Number(m.monto), 0),
      }))
      .sort((a, b) => b.total - a.total)
  }, [visibles])

  async function borrar(id: string) {
    const { error } = await supabase.from('movimientos').delete().eq('id', id)
    setBorrando(null)
    if (!error) cargar()
  }

  const nombreDe = (id: string) => perfiles.find((p) => p.id === id)?.nombre ?? '—'

  // "Fulano debe $X a Mengano" a partir de un diff con signo (positivo = p1 a favor)
  const lineaSaldo = (diff: number, p1: Profile, p2: Profile) => {
    if (Math.abs(diff) < 1) return 'a mano ✓'
    const deudor = diff > 0 ? p2 : p1
    const acreedor = diff > 0 ? p1 : p2
    return `${deudor.nombre} debe ${plata(Math.abs(diff))} a ${acreedor.nombre}`
  }

  // versión visual de lineaSaldo: el monto resalta en negrita y en
  // verde/rojo según te convenga a "vos" (en rojo si sos quien debe)
  const filaSaldo = (diff: number, p1: Profile, p2: Profile) => {
    if (Math.abs(diff) < 1) return <span className="font-semibold text-verde">a mano ✓</span>
    const deudor = diff > 0 ? p2 : p1
    const acreedor = diff > 0 ? p1 : p2
    const color = deudor.id === userId ? 'text-rojo' : 'text-verde'
    return (
      <>
        {deudor.nombre} debe{' '}
        <span className={`num font-semibold ${color}`}>{plata(Math.abs(diff))}</span> a{' '}
        {acreedor.nombre}
      </>
    )
  }

  const etiquetaDivision = (m: Movimiento) => {
    if (m.es_personal) return '🔒 personal'
    if (m.es_prestamo) return 'saldo'
    const o = origenProp(m, perfiles)
    if (o.tipo === 'partes') return 'partes'
    if (o.tipo === 'mitad') return 'mitad'
    if (o.tipo === 'pagador') return '100% pagador'
    const prop = Number(
      m.prop_pagador ?? perfiles.find((p) => p.id === m.pagado_por)?.porcentaje ?? 0.5
    )
    return `${Math.round(prop * 100)}% pagador`
  }

  function exportarCSV() {
    const filas = visibles.map((m) => [
      m.fecha.slice(0, 10),
      m.descripcion,
      m.categoria ?? '',
      m.tipo === 'gasto_fijo' ? 'fijo' : 'depto',
      nombreDe(m.pagado_por),
      etiquetaDivision(m),
      String(m.monto).replace('.', ','),
    ])
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`
    const csv =
      '\uFEFF' + // BOM para que Excel lo abra como UTF-8
      [
        ['fecha', 'descripcion', 'categoria', 'tipo', 'pago', 'division', 'monto'],
        ...filas,
      ]
        .map((r) => r.map(esc).join(';'))
        .join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    a.download = `gastos-${mes}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  async function copiarResumen() {
    const titulo = nombreMes(mes)
    const lineas = [`📒 *${titulo.charAt(0).toUpperCase() + titulo.slice(1)}* — La libreta`, '']
    lineas.push(`Compartido: ${plata(totalComp)} (${compMes.length} movimientos)`)
    for (const { perfil, pago, suParte } of auditoria?.porPersonaGastos ?? []) {
      lineas.push(`· ${perfil.nombre} pagó ${plata(pago)} · su parte ${plata(suParte)}`)
    }
    if (cierre) {
      if (cierre.saldado) {
        lineas.push('', `*✓ Saldado el ${fechaCorta(cierre.saldado.created_at)}*`)
      } else {
        if (auditoria && hayDesglose) {
          lineas.push('', 'Cómo se calculó, por categoría:')
          for (const grupo of auditoria.gruposPorCategoria) {
            lineas.push(
              `· ${grupo.categoria} (${plata(grupo.total)}): ${
                grupo.incluidoEnTotal
                  ? lineaSaldo(grupo.diff, auditoria.p1, auditoria.p2)
                  : 'no suma este mes (son las vigentes hoy)'
              }`
            )
          }
        }
        lineas.push('')
        if (cierre.monto >= 1)
          lineas.push(
            `*→ ${cierre.deudor.nombre} le transfiere ${plata(cierre.monto)} a ${cierre.acreedor.nombre}*`
          )
        else lineas.push('*→ A mano ✓*')
      }
    }
    if (debes.length > 0 || teDeben.length > 0) {
      lineas.push('', 'Cuotas activas:')
      for (const g of debes) {
        lineas.push(`· Debés a ${g.nombre}: ${plata(g.cuotaMensual)}/mes (faltan ${plata(g.restante)})`)
      }
      for (const g of teDeben) {
        lineas.push(`· Te debe ${g.nombre}: ${plata(g.cuotaMensual)}/mes (faltan ${plata(g.restante)})`)
      }
    }
    try {
      await navigator.clipboard.writeText(lineas.join('\n'))
      setCopiado(true)
      setTimeout(() => setCopiado(false), 1600)
    } catch {
      // sin permisos de clipboard: no rompemos nada
    }
  }

  const filaAcciones = (m: Movimiento) => (
    <span className="flex shrink-0 items-center gap-1.5">
      {borrando === m.id ? (
        <>
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
        </>
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
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14"/></svg>
          </button>
        </>
      )}
    </span>
  )

  return (
    <main className="mx-auto max-w-md px-4 pb-28 pt-6 lg:max-w-6xl">
      <h1 className="mb-3 text-2xl">Resumen</h1>

      {cargando ? (
        <p className="text-sm text-tinta-suave">Cargando…</p>
      ) : (
        <div className="lg:grid lg:grid-cols-[minmax(0,23rem)_minmax(0,1fr)] lg:items-start lg:gap-6">
          {/* ============ COLUMNA IZQUIERDA: el mes y su cierre ============ */}
          <div>
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
                  {(auditoria?.porPersonaGastos ?? []).map(({ perfil, pago, suParte, neto }) => (
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
                        pagó <span className="num font-medium text-tinta">{plata(pago)}</span> ·
                        su parte{' '}
                        <span className="num font-medium text-tinta">{plata(suParte)}</span>
                      </p>
                    </div>
                  ))}
                </div>
              )}
              {ajustesMes.length > 0 && (
                <p className="mt-2 text-xs text-tinta-suave">
                  Además se movieron{' '}
                  <span className="num">
                    {plata(ajustesMes.reduce((a, m) => a + Number(m.monto), 0))}
                  </span>{' '}
                  directo entre ustedes ({ajustesMes.length} préstamo
                  {ajustesMes.length === 1 ? '' : 's'}/devolución — ya cuentan en el neto).
                </p>
              )}

              {/* Antes de confiar en el neto y tacharlo: ¿está todo cargado
                  este mes? Vale para cualquier mes, no solo el actual. */}
              {!cierre?.saldado && faltantesDelMes.length > 0 && (
                <div className="mt-3 rounded-lg border border-ambar p-3 text-sm">
                  <p className="font-semibold text-ambar">
                    ⚠ Antes de tachar, revisá si falta cargar algo
                  </p>
                  <p className="mt-1 text-xs text-tinta-suave">
                    No hay nada anotado de {nombreMes(mes)} para:{' '}
                    <span className="font-medium text-tinta">
                      {faltantesDelMes.map((f) => f.nombre).join(', ')}
                    </span>
                    . Si ya se pagaron pero no se cargaron, el neto de abajo no los está
                    contando.
                  </p>
                  <Link
                    href="/nuevo"
                    className="mt-1.5 inline-block text-xs font-medium text-birome underline underline-offset-2"
                  >
                    Cargar lo que falta
                  </Link>
                </div>
              )}

              {/* Cierre del mes: a principio del mes siguiente se transfiere y se tacha */}
              {cierre &&
                hayTachado &&
                (compMes.length > 0 ||
                  ajustesMes.length > 0 ||
                  cierre.saldado ||
                  (esMesActual && cuotasInternasActivas.length > 0)) && (
                <div className="mt-4 border-t border-linea pt-3 text-sm">
                  {auditoria && hayDesglose && (
                    <div className="mb-3">
                      <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-tinta-suave">
                        Cómo se calculó, por categoría
                      </p>
                      <div className="grid gap-1 rounded-lg border border-linea p-3">
                        {auditoria.gruposPorCategoria.map((grupo) => (
                          <FuenteAuditoria
                            key={grupo.categoria}
                            titulo={grupo.categoria}
                            resumen={
                              <span className="inline-flex items-baseline gap-1.5">
                                <span className="text-tinta-suave">{plata(grupo.total)}</span>
                                {grupo.incluidoEnTotal ? (
                                  filaSaldo(grupo.diff, auditoria.p1, auditoria.p2)
                                ) : (
                                  <span className="text-tinta-suave">no suma este mes</span>
                                )}
                              </span>
                            }
                          >
                            {!grupo.incluidoEnTotal && (
                              <li className="py-1 text-xs text-tinta-suave">
                                Son las cuotas vigentes hoy, no las de {nombreMes(mes)}: solo
                                cuentan en el neto del mes en curso (ver /deudas).
                              </li>
                            )}
                            {grupo.lineas.map((l) => {
                              if (l.tipo === 'gasto') {
                                return (
                                  <li
                                    key={l.mov.id}
                                    className="flex items-baseline justify-between gap-2 py-1 text-xs"
                                  >
                                    <span className="min-w-0 truncate">
                                      {l.mov.descripcion}{' '}
                                      <span className="text-tinta-suave">
                                        · pagó {l.pagador.nombre}
                                      </span>
                                    </span>
                                    <span className="num shrink-0 pl-2 text-right text-tinta-suave">
                                      {plata(Number(l.mov.monto))} · {etiquetaOrigenProp(l.origen, l.prop)}{' '}
                                      → debe {l.otro.nombre}{' '}
                                      <span className="text-tinta">{plataExacta(l.quedaDebiendoOtro)}</span>
                                    </span>
                                  </li>
                                )
                              }
                              if (l.tipo === 'ajuste') {
                                return (
                                  <li
                                    key={l.mov.id}
                                    className="flex items-baseline justify-between gap-2 py-1 text-xs"
                                  >
                                    <span className="min-w-0 truncate">{l.mov.descripcion}</span>
                                    <span className="num shrink-0 pl-2 text-right text-tinta-suave">
                                      puso {l.pagador.nombre}{' '}
                                      <span className="text-tinta">{plataExacta(l.monto)}</span> ·
                                      100% a su favor
                                    </span>
                                  </li>
                                )
                              }
                              return (
                                <li
                                  key={l.deuda.id}
                                  className="flex items-baseline justify-between gap-2 py-1 text-xs"
                                >
                                  <span className="min-w-0 truncate">{l.deuda.descripcion}</span>
                                  <span className="num shrink-0 pl-2 text-right text-tinta-suave">
                                    {l.acreedor.nombre} recibe{' '}
                                    <span className="text-tinta">{plataExacta(l.valorCuota)}</span>
                                    /mes
                                  </span>
                                </li>
                              )
                            })}
                          </FuenteAuditoria>
                        ))}

                        <div className="flex items-baseline justify-between gap-2 border-t border-linea pt-2 text-sm font-semibold">
                          <span>= Neto del mes</span>
                          <span>{filaSaldo(auditoria.diffTotal, auditoria.p1, auditoria.p2)}</span>
                        </div>
                      </div>
                    </div>
                  )}
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
                      {hayDesglose
                        ? 'En total, las fuentes de arriba se cancelan: a mano ✓, no hay nada que transferir.'
                        : 'A mano ✓ — no hay nada que transferir.'}
                    </p>
                  ) : esMesActual ? (
                    <p className="text-tinta-suave">
                      {hayDesglose ? 'Mes en curso, en total: por ahora' : 'Mes en curso: por ahora'}{' '}
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

              <button
                onClick={copiarResumen}
                className="mt-3 text-xs font-medium text-birome underline underline-offset-2"
              >
                {copiado ? 'Copiado ✓ — pegalo en el chat' : '📋 Copiar resumen del mes'}
              </button>
            </section>

            {/* Deudas en cuotas */}
            <section className="card mb-4 p-4">
              <div className="flex items-baseline justify-between">
                <h2 className="text-lg">Deudas en cuotas</h2>
                <Link href="/deudas" className="text-sm font-medium text-birome">
                  Administrar
                </Link>
              </div>
              {debes.length === 0 && teDeben.length === 0 ? (
                <p className="mt-2 text-sm text-tinta-suave">No hay deudas activas. 🎉</p>
              ) : (
                <div className="mt-3 grid gap-4">
                  {debes.length > 0 && (
                    <div className="grid gap-3">
                      <p className="text-xs font-medium uppercase tracking-wide text-tinta-suave">
                        Debés
                      </p>
                      {debes.map((g) => (
                        <GrupoDeudasResumen key={`debes-${g.nombre}`} grupo={g} />
                      ))}
                    </div>
                  )}
                  {teDeben.length > 0 && (
                    <div className="grid gap-3">
                      <p className="text-xs font-medium uppercase tracking-wide text-tinta-suave">
                        Te deben
                      </p>
                      {teDeben.map((g) => (
                        <GrupoDeudasResumen key={`tedeben-${g.nombre}`} grupo={g} />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </section>

            {/* Lo personal tuyo */}
            <Link
              href="/personal"
              className="card mb-4 flex items-center justify-between p-4"
            >
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
          </div>

          {/* ============ COLUMNA DERECHA: gráficos y corrección ============ */}
          <div>
            {/* Evolución últimos 6 meses */}
            <section className="card mb-4 p-4">
              <h2 className="mb-1 text-lg">Evolución</h2>
              <p className="mb-3 text-xs text-tinta-suave">
                Compartido de los últimos 6 meses
                {variacion != null && (
                  <>
                    {' · '}
                    <span className={variacion > 0 ? 'text-rojo' : 'text-verde'}>
                      {variacion > 0 ? '▲' : '▼'} {Math.abs(variacion).toFixed(0)}%
                    </span>{' '}
                    vs {nombreMesCorto(mesAnterior.mes)}
                    {esMesActual ? ' (mes en curso)' : ''}
                  </>
                )}
              </p>
              <div className="flex items-end justify-between gap-2">
                {evolucion.map((e) => (
                  <button
                    key={e.mes}
                    type="button"
                    onClick={() => setMes(e.mes)}
                    className="group flex flex-1 flex-col items-center gap-1"
                    aria-label={`Ver ${nombreMes(e.mes)}`}
                  >
                    <span className="num text-[10px] text-tinta-suave">
                      {e.total > 0 ? plataCompacta(e.total) : ''}
                    </span>
                    <span className="flex h-24 w-full max-w-10 flex-col-reverse overflow-hidden rounded-t-md bg-birome-suave/40">
                      {perfiles.map((p, i) => (
                        <span
                          key={p.id}
                          style={{
                            height: `${(e.porPerfil[i] / maxEvolucion) * 100}%`,
                            background: COLORES_PERSONA[i % COLORES_PERSONA.length],
                          }}
                        />
                      ))}
                    </span>
                    <span
                      className={`text-xs capitalize ${
                        e.mes === mes ? 'font-bold text-birome' : 'text-tinta-suave'
                      }`}
                    >
                      {nombreMesCorto(e.mes)}
                    </span>
                  </button>
                ))}
              </div>
              {perfiles.length > 0 && (
                <div className="mt-2 flex gap-4 text-xs text-tinta-suave">
                  {perfiles.map((p, i) => (
                    <span key={p.id} className="flex items-center gap-1.5">
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-sm"
                        style={{ background: COLORES_PERSONA[i % COLORES_PERSONA.length] }}
                      />
                      {p.nombre}
                    </span>
                  ))}
                </div>
              )}
              {anual.total > 0 && (
                <p className="mt-2 border-t border-linea pt-2 text-xs text-tinta-suave">
                  Año {anio}: <span className="num font-medium text-tinta">{plata(anual.total)}</span>{' '}
                  compartidos · promedio{' '}
                  <span className="num font-medium text-tinta">{plata(anual.promedio)}</span>/mes
                </p>
              )}
            </section>

            {/* Por categoría (con límites opcionales) */}
            {porCategoria.length > 0 && (
              <section className="card mb-4 p-4">
                <h2 className="mb-3 text-lg">Por categoría</h2>
                <div className="grid gap-2.5">
                  {porCategoria.map(([cat, total]) => {
                    const limite = limiteDe(cat)
                    const pctLimite = limite ? (total / limite) * 100 : null
                    const colorBarra =
                      pctLimite == null
                        ? 'bg-birome'
                        : pctLimite > 100
                          ? 'bg-rojo'
                          : pctLimite > 80
                            ? 'bg-ambar'
                            : 'bg-verde'
                    return (
                      <div key={cat}>
                        <div className="flex items-baseline justify-between text-sm">
                          <span className="flex items-center gap-1.5 capitalize">
                            {cat}
                            {hayPresupuestos && (
                              <button
                                type="button"
                                className="text-xs text-tinta-suave hover:text-birome"
                                aria-label={`Límite de ${cat}`}
                                onClick={() => {
                                  setEditandoLimite(editandoLimite === cat ? null : cat)
                                  setLimiteInput(limite ? String(limite) : '')
                                }}
                              >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
                              </button>
                            )}
                          </span>
                          <span className="num font-medium">
                            {plata(total)}
                            <span
                              className={`ml-1 text-xs ${
                                pctLimite != null && pctLimite > 100
                                  ? 'font-semibold text-rojo'
                                  : 'text-tinta-suave'
                              }`}
                            >
                              {limite
                                ? `/ ${plata(limite)}`
                                : `(${Math.round((total / Math.max(1, totalComp)) * 100)}%)`}
                            </span>
                          </span>
                        </div>
                        {editandoLimite === cat && (
                          <div className="mt-1.5 flex items-center gap-1.5">
                            <input
                              className="input !w-32 !py-1.5 !text-sm num"
                              inputMode="decimal"
                              placeholder="Límite $ (vacío = sin límite)"
                              value={limiteInput}
                              autoFocus
                              onChange={(e) =>
                                setLimiteInput(e.target.value.replace(/[^\d.,]/g, ''))
                              }
                            />
                            <button
                              className="rounded bg-birome px-2 py-1.5 text-xs font-semibold text-white"
                              onClick={() => guardarLimite(cat)}
                            >
                              OK
                            </button>
                            <button
                              className="rounded border border-linea px-2 py-1.5 text-xs"
                              onClick={() => setEditandoLimite(null)}
                            >
                              ✕
                            </button>
                          </div>
                        )}
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-birome-suave">
                          <div
                            className={`h-full rounded-full ${colorBarra}`}
                            style={{
                              width: `${
                                pctLimite != null
                                  ? Math.max(4, Math.min(100, pctLimite))
                                  : Math.max(4, (total / maxCategoria) * 100)
                              }%`,
                            }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
                {hayPresupuestos && (
                  <p className="mt-3 text-xs text-tinta-suave">
                    ✎ = límite mensual opcional. La barra avisa: verde ok, ámbar pasando el
                    80%, rojo pasado.
                  </p>
                )}
              </section>
            )}

            {/* Movimientos: corregir y borrar */}
            <section>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h2 className="text-lg">Movimientos</h2>
                <div className="flex items-center gap-3">
                  <p className="num text-sm font-semibold">{plata(totalVisibles)}</p>
                  {visibles.length > 0 && (
                    <button
                      onClick={exportarCSV}
                      className="text-xs font-medium text-birome underline underline-offset-2"
                    >
                      ⬇ CSV
                    </button>
                  )}
                </div>
              </div>
              <div className="mb-3 grid gap-2">
                <div className="flex flex-wrap items-center gap-2">
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
                  {/* quién pagó: tocar de nuevo lo destilda */}
                  {perfiles.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className="chip"
                      data-activo={filtroPagador === p.id}
                      onClick={() =>
                        setFiltroPagador(filtroPagador === p.id ? '' : p.id)
                      }
                    >
                      pagó {p.nombre}
                    </button>
                  ))}
                  <select
                    className="input !w-auto !py-1.5 !text-sm"
                    aria-label="Filtrar por categoría"
                    value={filtroCat}
                    onChange={(e) => setFiltroCat(e.target.value)}
                  >
                    <option value="">todas las categorías</option>
                    {categoriasDelMes.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <input
                  className="input !py-2 !text-sm"
                  placeholder="Buscar (súper, farmacia…)"
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                />
              </div>

              {visibles.length === 0 ? (
                <div className="card p-5 text-center text-sm text-tinta-suave">
                  Nada por acá este mes.
                </div>
              ) : (
                <>
                  {/* Celular: desplegables por categoría */}
                  <div className="grid gap-2 lg:hidden">
                    {grupos.map(({ cat, lista, total }) => (
                      <details key={cat} className="card overflow-hidden" open={grupos.length === 1}>
                        <summary className="flex cursor-pointer list-none items-baseline justify-between px-4 py-3">
                          <span className="font-medium capitalize">
                            {cat}{' '}
                            <span className="text-xs text-tinta-suave">({lista.length})</span>
                          </span>
                          <span className="num font-semibold">{plata(total)}</span>
                        </summary>
                        <ul className="divide-y divide-linea border-t border-linea">
                          {lista.map((m) => (
                            <li key={m.id} className="px-4 py-3">
                              <div className="flex items-center justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="truncate font-medium">
                                    {m.descripcion}
                                    {m.es_personal && (
                                      <span className="ml-1 text-xs text-tinta-suave">🔒</span>
                                    )}
                                  </p>
                                  <p className="text-xs text-tinta-suave">
                                    {fechaCorta(m.fecha)} · {nombreDe(m.pagado_por)} ·{' '}
                                    {etiquetaDivision(m)}
                                  </p>
                                </div>
                                <div className="flex shrink-0 items-center gap-2">
                                  <p className="num font-semibold">{plata(Number(m.monto))}</p>
                                  {filaAcciones(m)}
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
                      </details>
                    ))}
                  </div>

                  {/* Escritorio: tabla para corregir */}
                  <div className="card hidden overflow-hidden lg:block">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-linea text-left text-xs uppercase tracking-wide text-tinta-suave">
                          <th className="px-3 py-2.5 font-medium">Fecha</th>
                          <th className="px-3 py-2.5 font-medium">Descripción</th>
                          <th className="px-3 py-2.5 font-medium">Categoría</th>
                          <th className="px-3 py-2.5 font-medium">Pagó</th>
                          <th className="px-3 py-2.5 font-medium">División</th>
                          <th className="px-3 py-2.5 text-right font-medium">Monto</th>
                          <th className="px-3 py-2.5" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-linea">
                        {visibles.map((m) => (
                          <Fragment key={m.id}>
                            <tr className="hover:bg-birome-suave/30">
                              <td className="num whitespace-nowrap px-3 py-2.5 text-tinta-suave">
                                {fechaCorta(m.fecha)}
                              </td>
                              <td className="max-w-55 truncate px-3 py-2.5 font-medium">
                                {m.descripcion}
                                {m.es_personal && <span className="ml-1 text-xs">🔒</span>}
                              </td>
                              <td className="px-3 py-2.5 capitalize text-tinta-suave">
                                {m.categoria ?? (m.tipo === 'gasto_fijo' ? 'servicios' : '—')}
                              </td>
                              <td className="px-3 py-2.5 text-tinta-suave">
                                {nombreDe(m.pagado_por)}
                              </td>
                              <td className="px-3 py-2.5 text-tinta-suave">
                                {etiquetaDivision(m)}
                              </td>
                              <td className="num px-3 py-2.5 text-right font-semibold">
                                {plata(Number(m.monto))}
                              </td>
                              <td className="px-3 py-2.5 text-right">{filaAcciones(m)}</td>
                            </tr>
                            {editando === m.id && (
                              <tr>
                                <td colSpan={7} className="px-3 py-2">
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
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </section>
          </div>
        </div>
      )}
      <Nav />
    </main>
  )
}

function GrupoDeudasResumen({ grupo }: { grupo: GrupoDeuda }) {
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-baseline justify-between gap-2">
        <p className="font-semibold">
          {grupo.nombre}{' '}
          <span className="inline-block text-xs text-tinta-suave transition-transform group-open:rotate-180">
            ▾
          </span>
        </p>
        {grupo.cuotaMensual > 0 && (
          <p className="text-sm text-tinta-suave">
            <span className="num font-semibold text-tinta">{plata(grupo.cuotaMensual)}</span>
            /mes · faltan <span className="num">{plata(grupo.restante)}</span>
          </p>
        )}
      </summary>
      <ul className="mt-1.5 grid gap-1">
        {grupo.deudas.map((d) => (
          <li
            key={d.id}
            className="flex items-baseline justify-between rounded-lg bg-birome-suave/40 px-3 py-1.5 text-sm"
          >
            <span className="min-w-0 truncate">{d.descripcion}</span>
            <span className="num shrink-0 pl-2 text-tinta-suave">
              {d.cuota_actual}/{d.cantidad_cuotas} · {plataExacta(Number(d.valor_cuota))}
            </span>
          </li>
        ))}
      </ul>
    </details>
  )
}

/** Una fuente del desglose auditable ("Gastos del depto", "Préstamos"…):
 * el resultado siempre visible, y cada línea que lo compone al desplegar. */
function FuenteAuditoria({
  titulo,
  resumen,
  children,
}: {
  titulo: string
  resumen: ReactNode
  children: ReactNode
}) {
  return (
    <details className="group py-1">
      <summary className="flex cursor-pointer list-none items-baseline justify-between gap-2 py-1">
        <span className="text-tinta-suave">
          {titulo}{' '}
          <span className="inline-block text-xs text-tinta-suave transition-transform group-open:rotate-180">
            ▾
          </span>
        </span>
        <span className="text-right">{resumen}</span>
      </summary>
      <ul className="mt-1 divide-y divide-linea border-t border-linea pl-1">{children}</ul>
    </details>
  )
}
