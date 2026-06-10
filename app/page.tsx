import { createClient } from '@/lib/supabase/server'
import { calcularBalance, plata, nombreMes, hoyArgentina } from '@/lib/format'
import type { Deuda, MesSaldado, Movimiento, Profile } from '@/lib/types'
import Nav from '@/components/Nav'
import LogoutButton from '@/components/LogoutButton'
import PerfilSetup from '@/components/PerfilSetup'
import TacharMes from '@/components/TacharMes'
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
  ] = await Promise.all([
    supabase.from('profiles').select('id, nombre, porcentaje'),
    // select('*'): si la migración v2 no corrió aún, es_personal no existe
    // y un select explícito rompería todo el dashboard
    supabase.from('movimientos').select('*').order('fecha', { ascending: false }),
    supabase.from('deudas').select('*').eq('activa', true),
    supabase.from('meses_saldados').select('*'),
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

  // --- saldo pendiente, mes por mes (cada gasto cuenta en el mes de su fecha) ---
  // Un mes "tachado" en meses_saldados ya se transfirió y no suma acá.
  const saldadosOk = (saldados ?? []) as MesSaldado[]
  const saldadosSet = new Set(saldadosOk.map((s) => s.mes))
  const netoDelMes = (mes: string) => {
    const delMes = compartidos.filter((m) => m.fecha.startsWith(mes))
    const puso = calcularBalance(delMes, perfilesOk)
    const miExtra = yo ? puso.get(yo.id) ?? 0 : 0
    const suExtra = otro ? puso.get(otro.id) ?? 0 : 0
    return miExtra - suExtra // > 0: el otro me debe ese mes
  }
  const mesesConMovs = [...new Set(compartidos.map((m) => m.fecha.slice(0, 7)))].sort()
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

  // --- cuotas del mes ---
  const deudasActivas = (deudas ?? []) as Deuda[]
  const totalCuotasMes = deudasActivas.reduce(
    (acc, d) => acc + Number(d.valor_cuota),
    0
  )

  const ultimos = compartidos.slice(0, 5)

  const necesitaSetup =
    yo && (yo.nombre === 'Nuevo' || perfilesOk.length < 2 || !otro)

  return (
    <main className="mx-auto max-w-md px-4 pb-28 pt-6">
      <header className="mb-5 flex items-baseline justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-birome">
            La libreta
          </p>
          <h1 className="text-2xl">Hola, {yo?.nombre ?? '…'}</h1>
        </div>
        <LogoutButton />
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
            {pendientes.some((p) => p.mes !== mesActual) && (
              <p className="mt-2 text-xs text-tinta-suave">
                ¿Ya se transfirió un mes? Tachalo y deja de contar.
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
        </Link>
        <Link href="/deudas" className="card block p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-tinta-suave">
            Cuotas del mes
          </p>
          <p className="num mt-1 text-2xl font-semibold">{plata(totalCuotasMes)}</p>
          <p className="mt-0.5 text-xs text-tinta-suave">
            {deudasActivas.length} deuda{deudasActivas.length === 1 ? '' : 's'} activa
            {deudasActivas.length === 1 ? '' : 's'}
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
      <Nav />
    </main>
  )
}
