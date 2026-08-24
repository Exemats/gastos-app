import { createClient } from '@/lib/supabase/server'
import { calcularBalance, calcularBalanceCuotasInternas, plata, nombreMes, hoyArgentina } from '@/lib/format'
import { coincideNombre } from '@/lib/parsear-gasto'
import { deudasQueDebes, deudasQueTeDeben } from '@/lib/deudas'
import type { Deuda, GastoFijo, MesSaldado, Movimiento, Presupuesto, Profile } from '@/lib/types'
import Nav from '@/components/Nav'
import LogoutButton from '@/components/LogoutButton'
import PerfilSetup from '@/components/PerfilSetup'
import TacharMes from '@/components/TacharMes'
import AvisosPush from '@/components/AvisosPush'
import RealtimeRefresh from '@/components/RealtimeRefresh'
import CargaRapida from '@/components/CargaRapida'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function Dashboard() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const [
    { data: perfiles },
    { data: movimientos },
    { data: deudas },
    { data: saldados, error: errorSaldados },
    { data: fijos },
    { data: presupuestos },
  ] = await Promise.all([
    supabase.from('profiles').select('id, nombre, porcentaje'),
    // select('*'): si la migración v2 no corrió aún, es_personal no existe
    // y un select explícito rompería todo el dashboard
    supabase.from('movimientos').select('*').order('fecha', { ascending: false }),
    // todas (no solo activas): una deuda de Expensas ya saldada igual cuenta
    // como "cargada este mes" para el recordatorio de fijos
    supabase.from('deudas').select('*'),
    supabase.from('meses_saldados').select('*'),
    supabase.from('gastos_fijos').select('*').eq('activo', true).order('nombre'),
    supabase.from('presupuestos').select('*'),
  ])

  // si la tabla nueva no existe, la migración no se corrió: avisamos
  const faltaMigracion = Boolean(errorSaldados)

  const perfilesOk: Profile[] = (perfiles ?? []).map((p) => ({
    ...p,
    porcentaje: Number(p.porcentaje),
  }))
  const yo = perfilesOk.find((p) => p.id === user?.id)
  const otro = perfilesOk.find((p) => p.id !== user?.id)

  const movs = (movimientos ?? []) as Movimiento[]
  // los personales (RLS solo trae los tuyos) quedan fuera de todo lo compartido
  const compartidos = movs.filter((m) => !m.es_personal)
  const personales = movs.filter((m) => m.es_personal)

  const hoy = hoyArgentina()
  const mesActual = hoy.slice(0, 7)

  // --- cuotas "entre nosotros": deudas activas que se le deben al otro,
  // su cuota de este mes cuenta como una 3ra fuente de saldo (junto con
  // gastos del depto y préstamos), solo para el mes en curso ---
  const deudasTodas = (deudas ?? []) as Deuda[]
  const balanceCuotasInternas = calcularBalanceCuotasInternas(deudasTodas, perfilesOk)

  // --- saldo pendiente, mes por mes (cada gasto cuenta en el mes de su fecha) ---
  // Un mes "tachado" en meses_saldados ya se transfirió y no suma acá.
  const saldadosOk = (saldados ?? []) as MesSaldado[]
  const saldadosSet = new Set(saldadosOk.map((s) => s.mes))
  const netoDelMes = (mes: string) => {
    const delMes = compartidos.filter((m) => m.fecha.startsWith(mes))
    const puso = calcularBalance(delMes, perfilesOk)
    if (mes === mesActual) {
      for (const p of perfilesOk) {
        puso.set(p.id, (puso.get(p.id) ?? 0) + (balanceCuotasInternas.get(p.id) ?? 0))
      }
    }
    const miExtra = yo ? puso.get(yo.id) ?? 0 : 0
    const suExtra = otro ? puso.get(otro.id) ?? 0 : 0
    return miExtra - suExtra // > 0: el otro me debe ese mes
  }
  // el mes en curso siempre se evalúa, aunque todavía no tenga movimientos
  // (puede tener saldo solo por cuotas entre ustedes)
  const mesesConMovs = [
    ...new Set([...compartidos.map((m) => m.fecha.slice(0, 7)), mesActual]),
  ].sort()
  const pendientes = mesesConMovs
    .filter((mes) => !saldadosSet.has(mes))
    .map((mes) => ({ mes, balance: netoDelMes(mes) }))
    .filter((x) => Math.abs(x.balance) >= 1)
  const balance = pendientes.reduce((a, x) => a + x.balance, 0)

  // meses ya tachados cuyo neto cambió después (se cargó/borró algo): avisar
  const tachadosCambiados = saldadosOk
    .filter(
      (s) =>
        s.monto != null &&
        Math.abs(Math.abs(netoDelMes(s.mes)) - Number(s.monto)) >= 1
    )
    .map((s) => s.mes)
    .sort()

  // --- gasto del mes ---
  const movsMes = compartidos.filter((m) => m.fecha.startsWith(mesActual))
  const gastoMes = movsMes
    .filter((m) => m.categoria !== 'ajuste')
    .reduce((acc, m) => acc + Number(m.monto), 0)
  const personalMes = personales
    .filter((m) => m.fecha.startsWith(mesActual))
    .reduce((acc, m) => acc + Number(m.monto), 0)

  // --- cuotas del mes: lo que debés vos (a Vicky o a un tercero) y lo
  // que te deben a vos (Vicky, o un tercero) ---
  const deudasActivas = deudasTodas.filter((d) => d.activa)
  const deudasActivasYo = deudasQueDebes(deudasActivas, yo?.id ?? null)
  const cuotasYoMes = deudasActivasYo.reduce((acc, d) => acc + Number(d.valor_cuota), 0)
  const deudasQueMeDeben = deudasQueTeDeben(deudasActivas, yo?.id ?? null)
  const cuotasQueMeDebenMes = deudasQueMeDeben.reduce((acc, d) => acc + Number(d.valor_cuota), 0)

  // --- fijos que faltan cargar este mes (luz, gas, expensas…) ---
  const fijosCatalogo = (fijos ?? []) as GastoFijo[]
  const fijosPendientes = fijosCatalogo.filter((f) => {
    if (f.paga_tercero) {
      // Expensas: además del movimiento, siempre se crea junto la deuda
      // con el tercero — alcanza con mirar esa
      return !deudasTodas.some(
        (d) =>
          coincideNombre(d.descripcion, f.nombre) &&
          (d.created_at?.startsWith(mesActual) ||
            d.fecha_primera_cuota?.startsWith(mesActual))
      )
    }
    return !movsMes.some((m) => coincideNombre(m.descripcion, f.nombre))
  })

  // --- límites de categoría pasados este mes ---
  const porCategoriaMes = new Map<string, number>()
  for (const m of movsMes) {
    if (m.categoria === 'ajuste') continue
    const c = m.categoria ?? (m.tipo === 'gasto_fijo' ? 'servicios' : 'sin categoría')
    porCategoriaMes.set(c, (porCategoriaMes.get(c) ?? 0) + Number(m.monto))
  }
  const limitesPasados = ((presupuestos ?? []) as Presupuesto[]).filter(
    (p) => (porCategoriaMes.get(p.categoria) ?? 0) > Number(p.monto)
  )

  // principio de mes: el momento de cerrar el mes anterior
  const esPrincipioDeMes = Number(hoy.slice(8, 10)) <= 7
  const hayMesesParaCerrar = pendientes.some((p) => p.mes !== mesActual)

  const ultimos = compartidos.slice(0, 5)

  const necesitaSetup =
    yo && (yo.nombre === 'Nuevo' || perfilesOk.length < 2 || !otro)

  return (
    <main className="mx-auto max-w-md px-4 pb-28 pt-6 lg:max-w-4xl">
      <header className="mb-5 flex items-baseline justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-birome">
            La libreta
          </p>
          <h1 className="text-2xl">Hola, {yo?.nombre ?? '…'}</h1>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/ajustes"
            aria-label="Ajustes"
            className="text-tinta-suave hover:text-birome"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/></svg>
          </Link>
          <LogoutButton />
        </div>
      </header>

      {faltaMigracion && (
        <div className="card mb-4 border-rojo bg-rojo-suave p-4 text-sm">
          <p className="font-semibold text-rojo">Falta un paso en Supabase</p>
          <p className="mt-1">
            Entrá a Supabase → SQL Editor, pegá el contenido de{' '}
            <span className="font-mono text-xs">docs/migracion_v2.sql</span> y dale Run
            (una sola vez). Hasta entonces funciona lo básico, pero sin gastos
            personales ni tachado de meses.
          </p>
        </div>
      )}

      {necesitaSetup && yo && (
        <PerfilSetup perfil={yo} hayOtro={Boolean(otro)} />
      )}

      {/* Carga rápida: un renglón y Enter, sin salir del inicio */}
      {user && perfilesOk.length > 0 && (
        <CargaRapida userId={user.id} perfiles={perfilesOk} fijos={fijosCatalogo} />
      )}

      <AvisosPush />
      <RealtimeRefresh />

      <div className="lg:grid lg:grid-cols-2 lg:items-start lg:gap-6">
      <div>
      {/* Saldo pendiente — la entrada de libreta */}
      <section className="card renglones mb-4 p-5">
        <p className="text-sm font-medium text-tinta-suave">Entre los dos</p>
        {!otro ? (
          <p className="mt-2 text-tinta-suave">
            Cuando {`se loguee la otra persona`} aparece acá el saldo.
          </p>
        ) : pendientes.length === 0 ? (
          <p className="num mt-1 text-4xl font-semibold text-verde">A mano ✓</p>
        ) : (
          <>
            {balance >= 1 ? (
              <>
                <p className="mt-1 text-lg">
                  <span className="font-semibold">{otro.nombre}</span> te debe
                </p>
                <p className="num text-5xl font-semibold leading-tight text-verde">
                  {plata(balance)}
                </p>
              </>
            ) : balance <= -1 ? (
              <>
                <p className="mt-1 text-lg">
                  Le debés a <span className="font-semibold">{otro.nombre}</span>
                </p>
                <p className="num text-5xl font-semibold leading-tight text-rojo">
                  {plata(-balance)}
                </p>
              </>
            ) : (
              <p className="num mt-1 text-4xl font-semibold text-verde">A mano ✓</p>
            )}

            {/* mes por mes: tachar cuando se transfiere */}
            <ul className="mt-4 grid gap-1.5">
              {pendientes.map(({ mes, balance: b }) => (
                <li
                  key={mes}
                  className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 rounded-lg bg-birome-suave/60 px-3 py-2 text-sm"
                >
                  <span className="capitalize">
                    {nombreMes(mes)}
                    {mes === mesActual && (
                      <span className="text-xs text-tinta-suave"> · en curso</span>
                    )}
                  </span>
                  <span className="flex items-center gap-3">
                    <span
                      className={`num font-semibold ${b > 0 ? 'text-verde' : 'text-rojo'}`}
                    >
                      {b > 0 ? `te debe ${plata(b)}` : `debés ${plata(-b)}`}
                    </span>
                    {mes !== mesActual && (
                      <TacharMes mes={mes} monto={Math.abs(b)} />
                    )}
                  </span>
                </li>
              ))}
            </ul>
            {hayMesesParaCerrar && (
              <p
                className={`mt-2 text-xs ${
                  esPrincipioDeMes ? 'font-medium text-birome' : 'text-tinta-suave'
                }`}
              >
                {esPrincipioDeMes
                  ? '📌 Principio de mes: transfieran la diferencia y tachen el mes pasado.'
                  : '¿Ya se transfirió un mes? Tachalo y deja de contar.'}
              </p>
            )}
          </>
        )}
        {otro && tachadosCambiados.length > 0 && (
          <p className="mt-3 text-xs text-rojo">
            Ojo: {tachadosCambiados.map((m) => nombreMes(m)).join(', ')}{' '}
            {tachadosCambiados.length === 1 ? 'cambió' : 'cambiaron'} después de
            tacharse.{' '}
            <Link href="/resumen" className="underline underline-offset-2">
              Revisalo en Resumen
            </Link>
            .
          </p>
        )}
      </section>

      {/* Fijos que faltan este mes */}
      {fijosPendientes.length > 0 && (
        <section className="card mb-4 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-tinta-suave">
            Fijos que faltan este mes
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {fijosPendientes.map((f) => (
              <Link
                key={f.id}
                href={`/nuevo?fijo=${encodeURIComponent(f.nombre)}`}
                className="chip"
              >
                + {f.nombre}
                {f.dia_vencimiento ? (
                  <span className="text-tinta-suave"> · vence el {f.dia_vencimiento}</span>
                ) : null}
              </Link>
            ))}
          </div>
        </section>
      )}
      </div>

      <div>
      {/* Resumen del mes */}
      <section className="mb-3 grid grid-cols-2 gap-3">
        <Link href="/resumen" className="card block p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-tinta-suave">
            Gastado este mes
          </p>
          <p className="num mt-1 text-2xl font-semibold">{plata(gastoMes)}</p>
          <p className="mt-0.5 text-xs text-tinta-suave">
            {movsMes.length} movimiento{movsMes.length === 1 ? '' : 's'}
          </p>
          {limitesPasados.length > 0 && (
            <p className="mt-1 text-xs font-medium text-rojo">
              ⚠ {limitesPasados.map((p) => p.categoria).join(', ')} arriba del límite
            </p>
          )}
        </Link>
        <Link href="/deudas" className="card block p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-tinta-suave">
            Tus cuotas del mes
          </p>
          <p className="num mt-1 text-2xl font-semibold">{plata(cuotasYoMes)}</p>
          <p className="mt-0.5 text-xs text-tinta-suave">
            {deudasActivasYo.length} deuda{deudasActivasYo.length === 1 ? '' : 's'} activa
            {deudasActivasYo.length === 1 ? '' : 's'}
            {cuotasQueMeDebenMes > 0 && ` · te deben ${plata(cuotasQueMeDebenMes)}`}
          </p>
        </Link>
      </section>

      {/* Lo personal tuyo */}
      <Link
        href="/personal"
        className="card mb-4 flex items-center justify-between px-4 py-3"
      >
        <p className="text-sm font-medium text-tinta-suave">Tus gastos personales 🔒</p>
        <p className="num font-semibold">{plata(personalMes)}</p>
      </Link>

      {/* Acción principal */}
      <Link href="/nuevo" className="btn btn-primario mb-6 w-full">
        + Cargar un gasto
      </Link>

      {/* Últimos movimientos */}
      <section>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-lg">Últimos movimientos</h2>
          <Link href="/resumen" className="text-sm font-medium text-birome">
            Ver todo
          </Link>
        </div>
        {ultimos.length === 0 ? (
          <div className="card p-5 text-center text-sm text-tinta-suave">
            Todavía no hay nada anotado. Cargá el primer gasto y arranca la libreta.
          </div>
        ) : (
          <ul className="card divide-y divide-linea">
            {ultimos.map((m) => {
              const pagador = perfilesOk.find((p) => p.id === m.pagado_por)
              return (
                <li key={m.id} className="flex items-center justify-between px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{m.descripcion}</p>
                    <p className="text-xs text-tinta-suave">
                      {pagador?.nombre ?? '—'} · {m.fecha.slice(8, 10)}/{m.fecha.slice(5, 7)}
                      {m.categoria ? ` · ${m.categoria}` : ''}
                    </p>
                  </div>
                  <p className="num shrink-0 pl-3 font-semibold">{plata(Number(m.monto))}</p>
                </li>
              )
            })}
          </ul>
        )}
      </section>
      </div>
      </div>
      <Nav />
    </main>
  )
}
