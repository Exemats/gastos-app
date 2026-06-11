'use client'
import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { plata, plataExacta, fechaCorta } from '@/lib/format'
import { parsearMonto } from '@/lib/parsear-gasto'
import type { Deuda, Profile } from '@/lib/types'
import Nav from '@/components/Nav'
import { useRealtime } from '@/lib/use-realtime'
import { avisar } from '@/lib/avisar'

export default function DeudasPage() {
  const supabase = createClient()
  const [deudas, setDeudas] = useState<Deuda[]>([])
  const [perfiles, setPerfiles] = useState<Profile[]>([])
  const [userId, setUserId] = useState<string | null>(null)
  const [verSaldadas, setVerSaldadas] = useState(false)
  const [mostrarForm, setMostrarForm] = useState(false)
  const [cargando, setCargando] = useState(true)

  const cargar = useCallback(async () => {
    const [{ data: u }, { data: d }, { data: p }] = await Promise.all([
      supabase.auth.getUser(),
      supabase.from('deudas').select('*').order('activa', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('profiles').select('id, nombre, porcentaje'),
    ])
    setUserId(u.user?.id ?? null)
    setDeudas((d ?? []) as Deuda[])
    setPerfiles((p ?? []).map((x) => ({ ...x, porcentaje: Number(x.porcentaje) })))
    setCargando(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    cargar()
  }, [cargar])
  useRealtime(cargar)

  async function pagarCuota(d: Deuda) {
    const nueva = d.cuota_actual + 1
    const { error } = await supabase
      .from('deudas')
      .update({ cuota_actual: nueva, activa: nueva < d.cantidad_cuotas })
      .eq('id', d.id)
    if (!error) cargar()
  }

  async function reactivar(d: Deuda) {
    const { error } = await supabase
      .from('deudas')
      .update({ cuota_actual: Math.max(0, d.cuota_actual - 1), activa: true })
      .eq('id', d.id)
    if (!error) cargar()
  }

  const visibles = deudas.filter((d) => (verSaldadas ? true : d.activa))
  const nombreDe = (id: string | null) =>
    perfiles.find((p) => p.id === id)?.nombre ?? '—'

  return (
    <main className="mx-auto max-w-md px-4 pb-28 pt-6 lg:max-w-2xl">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl">Deudas en cuotas</h1>
        <button className="btn btn-primario !py-2 !text-sm" onClick={() => setMostrarForm((v) => !v)}>
          {mostrarForm ? 'Cerrar' : '+ Nueva'}
        </button>
      </div>

      {mostrarForm && (
        <NuevaDeudaForm
          perfiles={perfiles}
          userId={userId}
          onCreada={() => {
            setMostrarForm(false)
            cargar()
          }}
        />
      )}

      {cargando ? (
        <p className="text-sm text-tinta-suave">Cargando…</p>
      ) : visibles.length === 0 ? (
        <div className="card p-5 text-center text-sm text-tinta-suave">
          No hay deudas activas. Cuando compren algo en cuotas, anotalo acá.
        </div>
      ) : (
        <ul className="grid gap-3">
          {visibles.map((d) => {
            const acreedor =
              d.acreedor_tipo === 'interno'
                ? nombreDe(d.acreedor_profile)
                : d.acreedor_nombre
            const restante = Number(d.valor_cuota) * d.cuotas_restantes
            const pct = (d.cuota_actual / d.cantidad_cuotas) * 100
            return (
              <li key={d.id} className={`card p-4 ${d.activa ? '' : 'opacity-60'}`}>
                <div className="flex items-baseline justify-between gap-2">
                  <p className="font-semibold">{d.descripcion}</p>
                  <p className="num shrink-0 text-sm text-tinta-suave">
                    {plataExacta(Number(d.valor_cuota))}/cuota
                  </p>
                </div>
                <p className="mt-0.5 text-sm text-tinta-suave">
                  {nombreDe(d.deudor)} le debe a {acreedor}
                  {d.fecha_primera_cuota ? ` · desde ${fechaCorta(d.fecha_primera_cuota)}` : ''}
                </p>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-birome-suave">
                  <div
                    className="h-full rounded-full bg-birome"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <p className="text-sm">
                    <span className="num font-semibold">
                      {d.cuota_actual}/{d.cantidad_cuotas}
                    </span>{' '}
                    pagadas ·{' '}
                    {d.activa ? (
                      <>
                        faltan <span className="num font-semibold">{plata(restante)}</span>
                      </>
                    ) : (
                      <span className="font-semibold text-verde">saldada ✓</span>
                    )}
                  </p>
                  {d.activa ? (
                    <button className="btn btn-secundario !px-3 !py-1.5 !text-sm" onClick={() => pagarCuota(d)}>
                      Pagué una cuota
                    </button>
                  ) : (
                    <button
                      className="text-xs text-tinta-suave underline"
                      onClick={() => reactivar(d)}
                    >
                      Deshacer
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <button
        className="mt-4 w-full text-center text-sm text-tinta-suave underline underline-offset-2"
        onClick={() => setVerSaldadas((v) => !v)}
      >
        {verSaldadas ? 'Ocultar saldadas' : 'Ver también las saldadas'}
      </button>
      <Nav />
    </main>
  )
}

function NuevaDeudaForm({
  perfiles,
  userId,
  onCreada,
}: {
  perfiles: Profile[]
  userId: string | null
  onCreada: () => void
}) {
  const supabase = createClient()
  const [descripcion, setDescripcion] = useState('')
  const [acreedorTipo, setAcreedorTipo] = useState<'externo' | 'interno'>('externo')
  const [acreedorNombre, setAcreedorNombre] = useState('')
  const [deudor, setDeudor] = useState(userId ?? '')
  const [montoTotal, setMontoTotal] = useState('')
  const [cuotas, setCuotas] = useState('')
  const [primeraCuota, setPrimeraCuota] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (userId && !deudor) setDeudor(userId)
  }, [userId, deudor])

  const otro = perfiles.find((p) => p.id !== deudor)

  async function crear(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    // entiende formato argentino: "12.500" = 12500, "12500,50" = 12500.5
    const monto = parsearMonto(montoTotal.trim())
    const n = parseInt(cuotas, 10)
    if (!descripcion.trim()) return setError('Falta la descripción.')
    if (!monto || monto <= 0) return setError('Poné el monto total.')
    if (!n || n < 1) return setError('Poné la cantidad de cuotas.')
    if (acreedorTipo === 'externo' && !acreedorNombre.trim())
      return setError('¿A quién se le debe?')
    if (acreedorTipo === 'interno' && !otro)
      return setError('Todavía no está el perfil de la otra persona.')

    setGuardando(true)
    const { data: creada, error } = await supabase.from('deudas').insert({
      descripcion: descripcion.trim(),
      acreedor_tipo: acreedorTipo,
      acreedor_nombre: acreedorTipo === 'externo' ? acreedorNombre.trim() : null,
      acreedor_profile: acreedorTipo === 'interno' ? otro?.id : null,
      deudor,
      monto_total: monto,
      cantidad_cuotas: n,
      fecha_primera_cuota: primeraCuota || null,
    }).select('id').single()
    setGuardando(false)
    if (error) setError(error.message)
    else {
      if (creada) avisar({ tipo: 'deuda', id: creada.id })
      onCreada()
    }
  }

  return (
    <form onSubmit={crear} className="card mb-4 grid gap-3 border-birome p-4">
      <input
        className="input"
        placeholder="Qué se compró (ej: Zapatillas Vans)"
        value={descripcion}
        onChange={(e) => setDescripcion(e.target.value)}
      />
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="chip text-center" data-activo={acreedorTipo === 'externo'} onClick={() => setAcreedorTipo('externo')}>
          A un tercero
        </button>
        <button type="button" className="chip text-center" data-activo={acreedorTipo === 'interno'} onClick={() => setAcreedorTipo('interno')}>
          Entre nosotros
        </button>
      </div>
      {acreedorTipo === 'externo' ? (
        <input
          className="input"
          placeholder="¿A quién? (Seba, Papá, Natasha…)"
          value={acreedorNombre}
          onChange={(e) => setAcreedorNombre(e.target.value)}
        />
      ) : (
        <p className="text-sm text-tinta-suave">
          Acreedor: <span className="font-semibold">{otro?.nombre ?? '—'}</span>
        </p>
      )}
      <div>
        <p className="mb-1 text-sm font-medium">¿Quién la paga?</p>
        <div className="grid grid-cols-2 gap-2">
          {perfiles.map((p) => (
            <button key={p.id} type="button" className="chip text-center" data-activo={deudor === p.id} onClick={() => setDeudor(p.id)}>
              {p.nombre}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input
          className="input num"
          inputMode="decimal"
          placeholder="Monto total $"
          value={montoTotal}
          onChange={(e) => setMontoTotal(e.target.value.replace(/[^\d.,]/g, ''))}
        />
        <input
          className="input num"
          inputMode="numeric"
          placeholder="N° de cuotas"
          value={cuotas}
          onChange={(e) => setCuotas(e.target.value.replace(/\D/g, ''))}
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor="primera">
          Primera cuota (opcional)
        </label>
        <input id="primera" type="date" className="input" value={primeraCuota} onChange={(e) => setPrimeraCuota(e.target.value)} />
      </div>
      <button className="btn btn-primario" disabled={guardando}>
        {guardando ? 'Creando…' : 'Crear deuda'}
      </button>
      {error && <p className="text-sm text-rojo">{error}</p>}
    </form>
  )
}
