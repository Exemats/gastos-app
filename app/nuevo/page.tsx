'use client'
import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { CATEGORIAS, type GastoFijo, type Profile } from '@/lib/types'
import { etiquetaPartes, hoyISO, nombreMes, plata } from '@/lib/format'
import { parsearGasto, parsearMonto, sinAcentos, coincideNombre } from '@/lib/parsear-gasto'
import { guardarGasto, parteTercero } from '@/lib/guardar-gasto'
import { errorLegible } from '@/lib/errores'
import Nav from '@/components/Nav'

function ayerISO() {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  const off = d.getTimezoneOffset()
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10)
}

type Frecuente = {
  descripcion: string
  monto: number
  categoria: string | null
  esPersonal: boolean
}

function NuevoGastoForm() {
  const router = useRouter()
  const params = useSearchParams()
  const supabase = createClient()

  const [perfiles, setPerfiles] = useState<Profile[]>([])
  const [fijos, setFijos] = useState<GastoFijo[]>([])
  const [sugerencias, setSugerencias] = useState<string[]>([])
  const [frecuentes, setFrecuentes] = useState<Frecuente[]>([])
  const [userId, setUserId] = useState<string | null>(null)

  const [tipo, setTipo] = useState<'gasto_depto' | 'gasto_fijo'>('gasto_depto')
  const [monto, setMonto] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [fecha, setFecha] = useState(hoyISO())
  const [pagadoPor, setPagadoPor] = useState('')
  const [categoria, setCategoria] = useState<string | null>(null)
  // "100% propio, sin dividir": va directo a tu sección Personal
  const [propio, setPropio] = useState(params.get('ambito') === 'personal')

  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [ok, setOk] = useState(false)

  useEffect(() => {
    async function cargar() {
      const [{ data: u }, { data: p }, { data: f }, { data: movs }] = await Promise.all([
        supabase.auth.getUser(),
        supabase.from('profiles').select('id, nombre, porcentaje'),
        supabase.from('gastos_fijos').select('*').eq('activo', true).order('nombre'),
        supabase
          .from('movimientos')
          .select('descripcion, monto, categoria, es_personal')
          .order('created_at', { ascending: false })
          .limit(300),
      ])
      const uid = u.user?.id ?? null
      const perfilesOk = (p ?? []).map((x) => ({ ...x, porcentaje: Number(x.porcentaje) }))
      const fijosOk = (f ?? []) as GastoFijo[]
      setUserId(uid)
      setPerfiles(perfilesOk)
      setFijos(fijosOk)
      if (uid) setPagadoPor(uid)

      // autocompletado + frecuentes con lo que ya cargaron otras veces
      const historial = (movs ?? []) as {
        descripcion: string
        monto: number
        categoria: string | null
        es_personal?: boolean
      }[]
      setSugerencias([...new Set(historial.map((m) => m.descripcion.trim()))].slice(0, 40))
      const cuenta = new Map<string, Frecuente & { veces: number }>()
      for (const m of historial) {
        const clave = sinAcentos(m.descripcion.trim())
        if (!clave || m.categoria === 'ajuste') continue
        if (fijosOk.some((x) => coincideNombre(m.descripcion, x.nombre))) continue
        const ya = cuenta.get(clave)
        if (ya) ya.veces++
        else
          cuenta.set(clave, {
            descripcion: m.descripcion.trim(),
            monto: Number(m.monto), // el más reciente (vienen ordenados desc)
            categoria: m.categoria,
            esPersonal: Boolean(m.es_personal),
            veces: 1,
          })
      }
      setFrecuentes(
        [...cuenta.values()]
          .filter((x) => x.veces >= 2)
          .sort((a, b) => b.veces - a.veces)
          .slice(0, 6)
      )

      // ¿Vino directo a cargar un fijo? (recordatorio del dashboard)
      const fijoParam = params.get('fijo')
      const fijoPedido = fijoParam
        ? fijosOk.find((x) => sinAcentos(x.nombre) === sinAcentos(fijoParam))
        : null
      if (fijoPedido) {
        setTipo('gasto_fijo')
        elegirFijo(fijoPedido)
        return
      }

      // Texto compartido a la app (share target / atajo): se parsea y precarga
      const texto = params.get('texto') || params.get('titulo')
      if (texto) {
        const r = parsearGasto(texto, perfilesOk.map((x) => x.nombre))
        if (r.ok) {
          setMonto(String(r.gasto.monto))
          setDescripcion(r.gasto.descripcion)
          setCategoria(r.gasto.categoria)
          if (r.gasto.esPersonal) setPropio(true)
          if (r.gasto.tipo === 'gasto_fijo') setTipo('gasto_fijo')
          const nombrado = r.gasto.pagadorNombre
            ? perfilesOk.find((x) => x.nombre === r.gasto.pagadorNombre)
            : null
          if (nombrado) setPagadoPor(nombrado.id)
        } else {
          setDescripcion(texto)
        }
      }
    }
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function elegirFijo(f: GastoFijo) {
    // los que paga un tercero (Expensas) llevan el mes en la descripción
    setDescripcion(
      f.paga_tercero ? `${f.nombre} ${nombreMes(hoyISO().slice(0, 7))}` : f.nombre
    )
    if (f.monto_estimado) setMonto(String(f.monto_estimado))
    setCategoria('servicios')
    setPropio(false)
  }

  function elegirFrecuente(fr: Frecuente) {
    setDescripcion(fr.descripcion)
    setMonto(String(fr.monto))
    setCategoria(fr.categoria)
    setPropio(fr.esPersonal)
  }

  // el fijo elegido se deriva de la descripción (así no queda colgado si la editan)
  const fijoElegido =
    tipo === 'gasto_fijo'
      ? fijos.find((f) => coincideNombre(descripcion, f.nombre)) ?? null
      : null
  const esTercero = Boolean(!propio && fijoElegido?.paga_tercero)
  const montoNum = parsearMonto(monto.trim()) ?? 0
  const montoTercero = fijoElegido ? parteTercero(montoNum, fijoElegido) : 0

  const yo = perfiles.find((p) => p.id === userId)

  async function guardar(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    // entiende formato argentino: "12.500" = 12500, "12500,50" = 12500.5
    const montoFinal = parsearMonto(monto.trim())
    if (!montoFinal || montoFinal <= 0) {
      setError('Poné un monto mayor a cero.')
      return
    }
    if (!descripcion.trim()) {
      setError('Falta la descripción.')
      return
    }
    setGuardando(true)
    const r = await guardarGasto(supabase, {
      monto: montoFinal,
      descripcion: descripcion.trim(),
      categoria,
      fecha,
      esPersonal: propio,
      tipo,
      // lo personal y lo que paga un tercero corren por cuenta de quien carga
      pagadorId: propio || esTercero ? userId ?? '' : pagadoPor || userId || '',
      fijo: propio ? null : fijoElegido,
    })
    setGuardando(false)
    if (!r.ok) {
      setError(errorLegible(r.error))
      return
    }
    setOk(true)
    const destino = r.clase === 'deuda' ? '/deudas' : propio ? '/personal' : '/'
    setTimeout(() => router.push(destino), 650)
  }

  return (
    <main className="mx-auto max-w-md px-4 pb-28 pt-6 lg:max-w-lg">
      <h1 className="mb-4 text-2xl">Cargar un gasto</h1>

      <div className="mb-2 grid grid-cols-2 gap-2">
        <button
          type="button"
          className="chip text-center"
          data-activo={tipo === 'gasto_depto'}
          onClick={() => setTipo('gasto_depto')}
        >
          Gasto del depto
        </button>
        <button
          type="button"
          className="chip text-center"
          data-activo={tipo === 'gasto_fijo'}
          onClick={() => setTipo('gasto_fijo')}
        >
          Servicio / fijo
        </button>
      </div>
      <p className="mb-3 text-xs text-tinta-suave">
        {propio
          ? 'Va a tu sección Personal: no se divide y solo vos lo ves.'
          : tipo === 'gasto_fijo'
            ? 'Los servicios se dividen mitad y mitad.'
            : `Se divide ${etiquetaPartes(perfiles)} según sus partes.`}
      </p>

      {tipo === 'gasto_fijo' && fijos.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {fijos.map((f) => (
            <button
              key={f.id}
              type="button"
              className="chip"
              data-activo={fijoElegido?.id === f.id}
              onClick={() => elegirFijo(f)}
            >
              {f.nombre}
              {f.paga_tercero ? ` (${f.paga_tercero})` : ''}
            </button>
          ))}
        </div>
      )}

      {tipo === 'gasto_depto' && frecuentes.length > 0 && (
        <div className="mb-4">
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-tinta-suave">
            Frecuentes
          </p>
          <div className="flex flex-wrap gap-2">
            {frecuentes.map((fr) => (
              <button
                key={fr.descripcion}
                type="button"
                className="chip !text-[13px]"
                data-activo={descripcion === fr.descripcion}
                onClick={() => elegirFrecuente(fr)}
              >
                {fr.descripcion} <span className="num">{plata(fr.monto)}</span>
                {fr.esPersonal ? ' 🔒' : ''}
              </button>
            ))}
          </div>
        </div>
      )}

      <form onSubmit={guardar} className="card grid gap-4 p-5">
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="monto">
            {esTercero ? `Monto total (lo que pagó ${fijoElegido?.paga_tercero})` : 'Monto'}
          </label>
          <div className="relative">
            <span className="num absolute left-3 top-1/2 -translate-y-1/2 text-lg text-tinta-suave">
              $
            </span>
            <input
              id="monto"
              className="input num !pl-8 !text-2xl"
              inputMode="decimal"
              placeholder="0"
              autoFocus
              value={monto}
              onChange={(e) => setMonto(e.target.value.replace(/[^\d.,]/g, ''))}
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="desc">
            Descripción
          </label>
          <input
            id="desc"
            className="input"
            list="sugerencias-desc"
            placeholder={
              propio
                ? 'Gym, ropa, regalo para mamá…'
                : tipo === 'gasto_fijo'
                  ? 'Luz, gas, internet…'
                  : 'Súper, salida, farmacia…'
            }
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
          />
          <datalist id="sugerencias-desc">
            {sugerencias.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </div>

        {esTercero && fijoElegido?.paga_tercero ? (
          <div className="rounded-lg bg-birome-suave p-3 text-sm">
            <p>
              Lo paga <span className="font-semibold">{fijoElegido.paga_tercero}</span>. Acá
              se anota la mitad de {yo?.nombre ?? 'quien carga'} —{' '}
              <span className="num font-semibold">{plata(montoTercero)}</span> — como deuda
              con {fijoElegido.paga_tercero}, junto a las demás.
            </p>
            <p className="mt-1 text-xs text-tinta-suave">
              Cuando se la pagues, la tachás en Cuotas (&quot;Pagué una cuota&quot;).
            </p>
          </div>
        ) : (
          !propio && (
            <div>
              <p className="mb-1 text-sm font-medium">¿Quién lo pagó?</p>
              <div className="grid grid-cols-2 gap-2">
                {perfiles.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="chip text-center"
                    data-activo={pagadoPor === p.id}
                    onClick={() => setPagadoPor(p.id)}
                  >
                    {p.nombre}
                    {p.id === userId ? ' (vos)' : ''}
                  </button>
                ))}
              </div>
            </div>
          )
        )}

        {!esTercero && (
          <div>
            <p className="mb-1 text-sm font-medium">Categoría (opcional)</p>
            <div className="flex flex-wrap gap-2">
              {CATEGORIAS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="chip"
                  data-activo={categoria === c}
                  onClick={() => setCategoria(categoria === c ? null : c)}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="block text-sm font-medium" htmlFor="fecha">
              {esTercero ? 'Fecha (primera y única cuota)' : 'Fecha'}
            </label>
            <span className="flex gap-1.5">
              <button
                type="button"
                className="chip !px-2.5 !py-1 !text-xs"
                data-activo={fecha === hoyISO()}
                onClick={() => setFecha(hoyISO())}
              >
                Hoy
              </button>
              <button
                type="button"
                className="chip !px-2.5 !py-1 !text-xs"
                data-activo={fecha === ayerISO()}
                onClick={() => setFecha(ayerISO())}
              >
                Ayer
              </button>
            </span>
          </div>
          <input
            id="fecha"
            type="date"
            className="input"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
          />
        </div>

        {!esTercero && (
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={propio}
              onChange={(e) => setPropio(e.target.checked)}
            />
            <span>
              100% propio, sin dividir 🔒{' '}
              <span className="text-tinta-suave">
                (va a tu sección Personal — solo vos lo ves)
              </span>
            </span>
          </label>
        )}

        <button className="btn btn-primario" disabled={guardando || ok}>
          {ok
            ? 'Anotado ✓'
            : guardando
              ? 'Anotando…'
              : esTercero
                ? `Anotar deuda con ${fijoElegido?.paga_tercero}`
                : propio
                  ? 'Anotar en lo tuyo 🔒'
                  : 'Anotar en la libreta'}
        </button>
        {error && <p className="text-sm text-rojo">{error}</p>}
      </form>
      <Nav />
    </main>
  )
}

export default function NuevoGasto() {
  return (
    <Suspense>
      <NuevoGastoForm />
    </Suspense>
  )
}
