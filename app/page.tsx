import { createClient } from '@/lib/supabase/server'
import { calcularBalance, plata, hoyISO } from '@/lib/format'
import type { Deuda, Profile } from '@/lib/types'
import Nav from '@/components/Nav'
import LogoutButton from '@/components/LogoutButton'
import PerfilSetup from '@/components/PerfilSetup'
import SaldarButton from '@/components/SaldarButton'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function Dashboard() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const [{ data: perfiles }, { data: movimientos }, { data: deudas }] =
    await Promise.all([
      supabase.from('profiles').select('id, nombre, porcentaje'),
      supabase
        .from('movimientos')
        .select('monto, pagado_por, prop_pagador, fecha, tipo, descripcion, categoria, id')
        .order('fecha', { ascending: false }),
      supabase.from('deudas').select('*').eq('activa', true),
    ])

  const perfilesOk: Profile[] = (perfiles ?? []).map((p) => ({
    ...p,
    porcentaje: Number(p.porcentaje),
  }))
  const yo = perfilesOk.find((p) => p.id === user?.id)
  const otro = perfilesOk.find((p) => p.id !== user?.id)

  // --- saldo neto ---
  const pusoDeMas = calcularBalance(movimientos ?? [], perfilesOk)
  const miExtra = yo ? pusoDeMas.get(yo.id) ?? 0 : 0
  const suExtra = otro ? pusoDeMas.get(otro.id) ?? 0 : 0
  const balance = miExtra - suExtra // > 0: el otro me debe

  // --- gasto del mes ---
  const mesActual = hoyISO().slice(0, 7)
  const movsMes = (movimientos ?? []).filter((m) => m.fecha.startsWith(mesActual))
  const gastoMes = movsMes
    .filter((m) => m.categoria !== 'ajuste')
    .reduce((acc, m) => acc + Number(m.monto), 0)

  // --- cuotas del mes ---
  const deudasActivas = (deudas ?? []) as Deuda[]
  const totalCuotasMes = deudasActivas.reduce(
    (acc, d) => acc + Number(d.valor_cuota),
    0
  )

  const ultimos = (movimientos ?? []).slice(0, 5)

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

      {necesitaSetup && yo && (
        <PerfilSetup perfil={yo} hayOtro={Boolean(otro)} />
      )}

      {/* Saldo neto — la entrada de libreta */}
      <section className="card renglones mb-4 p-5">
        <p className="text-sm font-medium text-tinta-suave">Entre los dos</p>
        {!otro ? (
          <p className="mt-2 text-tinta-suave">
            Cuando {`se loguee la otra persona`} aparece acá el saldo.
          </p>
        ) : Math.abs(balance) < 1 ? (
          <p className="num mt-1 text-4xl font-semibold text-verde">A mano ✓</p>
        ) : balance > 0 ? (
          <>
            <p className="mt-1 text-lg">
              <span className="font-semibold">{otro.nombre}</span> te debe
            </p>
            <p className="num text-5xl font-semibold leading-tight text-verde">
              {plata(balance)}
            </p>
          </>
        ) : (
          <>
            <p className="mt-1 text-lg">
              Le debés a <span className="font-semibold">{otro.nombre}</span>
            </p>
            <p className="num text-5xl font-semibold leading-tight text-rojo">
              {plata(-balance)}
            </p>
          </>
        )}
        {otro && Math.abs(balance) >= 1 && yo && (
          <SaldarButton
            monto={Math.abs(balance)}
            deudorId={balance < 0 ? yo.id : otro.id}
            deudorEsUsuario={balance < 0}
            nombreOtro={otro.nombre}
          />
        )}
      </section>

      {/* Resumen del mes */}
      <section className="mb-4 grid grid-cols-2 gap-3">
        <div className="card p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-tinta-suave">
            Gastado este mes
          </p>
          <p className="num mt-1 text-2xl font-semibold">{plata(gastoMes)}</p>
          <p className="mt-0.5 text-xs text-tinta-suave">
            {movsMes.length} movimiento{movsMes.length === 1 ? '' : 's'}
          </p>
        </div>
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

      {/* Acción principal */}
      <Link href="/nuevo" className="btn btn-primario mb-6 w-full">
        + Cargar un gasto
      </Link>

      {/* Últimos movimientos */}
      <section>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-lg">Últimos movimientos</h2>
          <Link href="/historial" className="text-sm font-medium text-birome">
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
