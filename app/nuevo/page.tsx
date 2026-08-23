'use client'
import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { CATEGORIAS, type GastoFijo, type Profile } from '@/lib/types'
import { etiquetaPartes, hoyISO, nombreMes, plata } from '@/lib/format'
import {
  parsearGasto,
  parsearMonto,
  sinAcentos,
  coincideNombre,
  categoriaSugerida,
} from '@/lib/parsear-gasto'
import { guardarGasto, parteTercero } from '@/lib/guardar-gasto'
import { errorLegible } from '@/lib/errores'
import Nav from '@/components/Nav'
import Descuento, { calcularDescuento } from '@/components/Descuento'

function ayerISO() {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  const off = d.getTimezoneOffset()
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10)
}

type Modo = 'gasto' | 'plata'
type Division = 'partes' | 'mitad' | 'personal'

type Frecuente = {
  descripcion: string
  monto: number
  categoria: string | null
  esPersonal: boolean
}

/* ------------------------------------------------------------------ */
/* Bloques reutilizables del formulario                                 */
/* ------------------------------------------------------------------ */

function ChipsOpciones<T extends string>({
  opciones,
  valor,
  onChange,
  enGrilla = false,
}: {
  opciones: { id: T; etiqueta: string; deshabilitado?: boolean }[]
  valor: T | null
  onChange: (v: T) => void
  enGrilla?: boolean
}) {
  return (
    <div className={enGrilla ? 'grid grid-cols-2 gap-2' : 'flex flex-wrap gap-2'}>
      {opciones.map((o) => (
        <button
          key={o.id}
          type="button"
          className={`chip ${enGrilla ? 'text-center' : ''}`}
          data-activo={valor === o.id}
          disabled={o.deshabilitado}
          onClick={() => onChange(o.id)}
        >
          {o.etiqueta}
        </button>
      ))}
    </div>
  )
}

function CampoMonto({
  etiqueta = 'Monto',
  valor,
  onChange,
  conFoco = false,
  className = '',
}: {
  etiqueta?: string
  valor: string
  onChange: (v: string) => void
  conFoco?: boolean
  className?: string
}) {
  return (
    <div className={className}>
      <label className="mb-1 block text-sm font-medium" htmlFor="monto">
        {etiqueta}
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
          autoFocus={conFoco}
          value={valor}
          onChange={(e) => onChange(e.target.value.replace(/[^\d.,]/g, ''))}
        />
      </div>
    </div>
  )
}

function CampoFecha({
  etiqueta = 'Fecha',
  valor,
  onChange,
  className = '',
}: {
  etiqueta?: string
  valor: string
  onChange: (v: string) => void
  className?: string
}) {
  return (
    <div className={className}>
      <div className="mb-1 flex items-center justify-between">
        <label className="block text-sm font-medium" htmlFor="fecha">
          {etiqueta}
        </label>
        <span className="flex gap-1.5">
          <button
            type="button"
            className="chip !px-2.5 !py-1 !text-xs"
            data-activo={valor === hoyISO()}
            onClick={() => onChange(hoyISO())}
          >
            Hoy
          </button>
          <button
            type="button"
            className="chip !px-2.5 !py-1 !text-xs"
            data-activo={valor === ayerISO()}
            onClick={() => onChange(ayerISO())}
          >
            Ayer
          </button>
        </span>
      </div>
      <input
        id="fecha"
        type="date"
        className="input"
        value={valor}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

function SelectorPersona({
  etiqueta,
  perfiles,
  userId,
  valor,
  onChange,
  className = '',
}: {
  etiqueta: string
  perfiles: Profile[]
  userId: string | null
  valor: string
  onChange: (id: string) => void
  className?: string
}) {
  return (
    <div className={className}>
      <p className="mb-1 text-sm font-medium">{etiqueta}</p>
      <ChipsOpciones
        enGrilla
        opciones={perfiles.map((p) => ({
          id: p.id,
          etiqueta: p.nombre + (p.id === userId ? ' (vos)' : ''),
        }))}
        valor={valor}
        onChange={onChange}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* La pantalla                                                          */
/* ------------------------------------------------------------------ */

function NuevoGastoForm() {
  const router = useRouter()
  const params = useSearchParams()
  const supabase = createClient()

  const [perfiles, setPerfiles] = useState<Profile[]>([])
  const [fijos, setFijos] = useState<GastoFijo[]>([])
  const [sugerencias, setSugerencias] = useState<string[]>([])
  const [frecuentes, setFrecuentes] = useState<Frecuente[]>([])
  const [userId, setUserId] = useState<string | null>(null)

  const [modo, setModo] = useState<Modo>('gasto')
  const [monto, setMonto] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [fecha, setFecha] = useState(hoyISO())
  // gasto: quién lo pagó · plata: quién puso la plata
  const [pagadoPor, setPagadoPor] = useState('')
  const [division, setDivision] = useState<Division>(
    params.get('ambito') === 'personal' ? 'personal' : 'partes'
  )
  // true = la eligió a mano: el catálogo solo sugiere, el selector manda
  const [divisionManual, setDivisionManual] = useState(
    params.get('ambito') === 'personal'
  )
  const [categoria, setCategoria] = useState<string | null>(null)
  // true = la eligió a mano (o vino de un frecuente): no se pisa al tipear
  const [categoriaManual, setCategoriaManual] = useState(false)
  // descuento de promo: un check; al marcarlo aparecen % y tope
  const [conDescuento, setConDescuento] = useState(false)
  const [descuentoPct, setDescuentoPct] = useState('')
  const [topeReintegro, setTopeReintegro] = useState('')

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
        elegirServicio(fijoPedido)
        return
      }

      // Texto compartido a la app (share target / atajo): se parsea y precarga
      const texto = params.get('texto') || params.get('titulo')
      if (texto) {
        const r = parsearGasto(texto, perfilesOk.map((x) => x.nombre))
        if (!r.ok) {
          setDescripcion(texto)
          return
        }
        const g = r.gasto
        setMonto(String(g.monto))
        setDescripcion(g.descripcion)
        const nombrado = g.pagadorNombre
          ? perfilesOk.find((x) => x.nombre === g.pagadorNombre)
          : null
        if (nombrado) setPagadoPor(nombrado.id)
        if (g.esAjuste) {
          setModo('plata')
        } else {
          setCategoria(g.categoria)
          if (g.categoria) setCategoriaManual(true)
          setDivision(g.esPersonal ? 'personal' : g.esMitad ? 'mitad' : 'partes')
          if (g.esPersonal || g.esMitad) setDivisionManual(true)
        }
      }
    }
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function cambiarDescripcion(v: string) {
    setDescripcion(v)
    // categoría sugerida por la descripción ("uber" → transporte),
    // solo mientras no haya una elegida a mano
    if (!categoriaManual) setCategoria(categoriaSugerida(v))
    // si coincide con un servicio del catálogo, sugiere su división de la
    // casa (50/50); el selector siempre puede pisarla
    if (!divisionManual) {
      const f = fijos.find((x) => coincideNombre(v, x.nombre))
      setDivision(
        f && !f.paga_tercero && Number(f.prop_pagador) === 0.5 ? 'mitad' : 'partes'
      )
    }
  }

  function elegirServicio(f: GastoFijo) {
    setModo('gasto')
    // los que paga un tercero (Expensas) llevan el mes en la descripción
    setDescripcion(
      f.paga_tercero ? `${f.nombre} ${nombreMes(hoyISO().slice(0, 7))}` : f.nombre
    )
    if (f.monto_estimado && !monto.trim()) setMonto(String(f.monto_estimado))
    setCategoria('servicios')
    setCategoriaManual(true)
    if (!f.paga_tercero) {
      setDivision(Number(f.prop_pagador) === 0.5 ? 'mitad' : 'partes')
      setDivisionManual(false) // es una sugerencia de la casa, no una elección
    }
  }

  function elegirFrecuente(fr: Frecuente) {
    setDescripcion(fr.descripcion)
    setMonto(String(fr.monto))
    setCategoria(fr.categoria)
    setCategoriaManual(Boolean(fr.categoria))
    setDivision(fr.esPersonal ? 'personal' : 'partes')
    setDivisionManual(fr.esPersonal)
  }

  const yo = perfiles.find((p) => p.id === userId)
  const otro = perfiles.find((p) => p.id !== userId)

  // el fijo se detecta solo por la descripción y aplica su regla del catálogo
  const fijoElegido =
    modo === 'gasto' && division !== 'personal'
      ? fijos.find((f) => coincideNombre(descripcion, f.nombre)) ?? null
      : null
  const esTercero = Boolean(fijoElegido?.paga_tercero)
  const montoNum = parsearMonto(monto.trim()) ?? 0
  // con descuento, todo se calcula sobre el neto (lo que costó de verdad)
  const montoNeto = conDescuento
    ? calcularDescuento(montoNum, descuentoPct, topeReintegro)?.neto ?? montoNum
    : montoNum
  const montoTercero = fijoElegido ? parteTercero(montoNeto, fijoElegido) : 0
  const nombreTerceroDeudor =
    perfiles.find((p) => p.id === fijoElegido?.tercero_deudor)?.nombre ??
    yo?.nombre ??
    'quien carga'

  const DIVISIONES: { id: Division; etiqueta: string }[] = [
    { id: 'partes', etiqueta: etiquetaPartes(perfiles) },
    { id: 'mitad', etiqueta: '50/50' },
    { id: 'personal', etiqueta: '100% propio 🔒' },
  ]
  const NOTAS_DIVISION: Record<Division, string> = {
    partes: 'La regla general del depto: cada uno su parte.',
    mitad: 'Partes iguales (un café, una salida, los servicios).',
    personal: 'No se divide, no toca el saldo y solo vos lo ves (va a Personal).',
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    // entiende formato argentino: "12.500" = 12500, "12500,50" = 12500.5
    let montoFinal = parsearMonto(monto.trim())
    if (!montoFinal || montoFinal <= 0) {
      setError('Poné un monto mayor a cero.')
      return
    }
    if (modo === 'gasto' && conDescuento) {
      const d = calcularDescuento(montoFinal, descuentoPct, topeReintegro)
      if (!d) {
        setError('Poné el % de descuento (o destildá el descuento).')
        return
      }
      montoFinal = d.neto
    }

    setGuardando(true)
    let r
    if (modo === 'plata') {
      r = await guardarGasto(
        supabase,
        {
          monto: montoFinal,
          descripcion: descripcion.trim() || 'Préstamo',
          categoria: null,
          fecha,
          esPersonal: false,
          esAjuste: true,
          tipo: 'gasto_depto',
          pagadorId: pagadoPor || userId || '',
        },
        perfiles
      )
    } else {
      if (!descripcion.trim()) {
        setGuardando(false)
        setError('Falta la descripción.')
        return
      }
      if (!categoria && !esTercero) {
        setGuardando(false)
        setError('Elegí una categoría — si ninguna pega, está «otros».')
        return
      }
      const personal = division === 'personal'
      r = await guardarGasto(
        supabase,
        {
          monto: montoFinal,
          descripcion: descripcion.trim(),
          categoria,
          fecha,
          esPersonal: personal,
          // la división la decide el selector (el catálogo solo la sugiere);
          // undefined = sin regla explícita, se resuelve y congela abajo
          prop: division === 'mitad' ? 0.5 : undefined,
          tipo: fijoElegido ? 'gasto_fijo' : 'gasto_depto',
          // lo personal y lo que paga un tercero corren por cuenta de quien carga
          pagadorId: personal || esTercero ? userId ?? '' : pagadoPor || userId || '',
          fijo: fijoElegido,
        },
        perfiles
      )
    }
    setGuardando(false)
    if (!r.ok) {
      setError(errorLegible(r.error))
      return
    }
    setOk(true)
    const vaADeudas = r.clase === 'deuda' || Boolean(r.deudaId)
    const destino = vaADeudas
      ? '/deudas'
      : division === 'personal' && modo === 'gasto'
        ? '/personal'
        : '/'
    setTimeout(() => router.push(destino), 650)
  }

  return (
    <main className="mx-auto max-w-md px-4 pb-28 pt-6 lg:max-w-2xl">
      <h1 className="mb-4 text-2xl">Cargar</h1>

      {/* Qué se anota: un gasto, o plata que se prestaron/devolvieron */}
      <div className="mb-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          className="chip text-center"
          data-activo={modo === 'gasto'}
          onClick={() => setModo('gasto')}
        >
          Gasto
        </button>
        <button
          type="button"
          className="chip text-center"
          data-activo={modo === 'plata'}
          disabled={!otro}
          onClick={() => setModo('plata')}
        >
          Plata entre nosotros
        </button>
      </div>

      {modo === 'gasto' && frecuentes.length > 0 && (
        <div className="mb-3">
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

      {modo === 'gasto' ? (
        /* ============================ GASTO ============================ */
        /* en pantalla grande el formulario va en dos columnas */
        <form onSubmit={guardar} className="card grid gap-4 p-5 lg:grid-cols-2 lg:gap-x-6">
          <CampoMonto
            conFoco
            etiqueta={esTercero ? `Monto total (lo que pagó ${fijoElegido?.paga_tercero})` : 'Monto'}
            valor={monto}
            onChange={setMonto}
          />

          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="desc">
              Descripción
            </label>
            <input
              id="desc"
              className="input"
              list="sugerencias-desc"
              placeholder={
                division === 'personal'
                  ? 'Gym, ropa, regalo para mamá…'
                  : 'Súper, luz, salida, farmacia…'
              }
              value={descripcion}
              onChange={(e) => cambiarDescripcion(e.target.value)}
            />
            <datalist id="sugerencias-desc">
              {sugerencias.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </div>

          <div className="lg:col-span-2">
            <Descuento
              activo={conDescuento}
              onActivo={setConDescuento}
              pct={descuentoPct}
              onPct={setDescuentoPct}
              tope={topeReintegro}
              onTope={setTopeReintegro}
              bruto={montoNum}
            />
          </div>

          {esTercero && fijoElegido?.paga_tercero ? (
            <div className="rounded-lg bg-birome-suave p-3 text-sm lg:col-span-2">
              <p>
                Se anota como gasto del depto, dividido como cualquier servicio. Además,
                como lo paga <span className="font-semibold">{fijoElegido.paga_tercero}</span>,
                la mitad — <span className="num font-semibold">{plata(montoTercero)}</span> —
                queda como deuda de {nombreTerceroDeudor} con {fijoElegido.paga_tercero}, junto
                a las demás.
              </p>
              <p className="mt-1 text-xs text-tinta-suave">
                Cuando se la pagues, la tachás en Cuotas (&quot;Pagué una cuota&quot;).
              </p>
            </div>
          ) : (
            <>
              {division !== 'personal' && (
                <SelectorPersona
                  etiqueta="¿Quién lo pagó?"
                  perfiles={perfiles}
                  userId={userId}
                  valor={pagadoPor}
                  onChange={setPagadoPor}
                />
              )}

              <div>
                <p className="mb-1 text-sm font-medium">¿Cómo se divide?</p>
                <ChipsOpciones
                  opciones={DIVISIONES}
                  valor={division}
                  onChange={(d) => {
                    setDivision(d)
                    setDivisionManual(true)
                  }}
                />
                <p className="mt-1.5 text-xs text-tinta-suave">
                  {NOTAS_DIVISION[division]}
                </p>
              </div>
            </>
          )}

          {!esTercero && (
            <div className="lg:col-span-2">
              <p className="mb-1 text-sm font-medium">Categoría</p>
              <div className="flex flex-wrap gap-2">
                {CATEGORIAS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className="chip"
                    data-activo={categoria === c}
                    onClick={() => {
                      const limpiar = categoria === c
                      setCategoria(limpiar ? null : c)
                      setCategoriaManual(!limpiar)
                    }}
                  >
                    {c}
                  </button>
                ))}
              </div>
              {/* servicios despliega las subcategorías del catálogo: un tap
                  precarga descripción, monto estimado y la división de la casa */}
              {categoria === 'servicios' && fijos.length > 0 && (
                <>
                  <p className="mb-1 mt-2 text-xs text-tinta-suave">¿Cuál?</p>
                  <div className="flex flex-wrap gap-2">
                    {fijos.map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        className="chip !text-[13px]"
                        data-activo={fijoElegido?.id === f.id}
                        onClick={() => elegirServicio(f)}
                      >
                        {f.nombre}
                        {f.paga_tercero ? ` (${f.paga_tercero})` : ''}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          <CampoFecha
            etiqueta={esTercero ? 'Fecha (primera y única cuota)' : 'Fecha'}
            valor={fecha}
            onChange={setFecha}
          />

          <button className="btn btn-primario lg:self-end" disabled={guardando || ok}>
            {ok
              ? 'Anotado ✓'
              : guardando
                ? 'Anotando…'
                : division === 'personal'
                  ? 'Anotar en lo tuyo 🔒'
                  : 'Anotar en la libreta'}
          </button>
          {error && <p className="text-sm text-rojo lg:col-span-2">{error}</p>}
        </form>
      ) : (
        /* ===================== PLATA ENTRE NOSOTROS ===================== */
        <form onSubmit={guardar} className="card grid gap-4 p-5 lg:grid-cols-2 lg:gap-x-6">
          <SelectorPersona
            etiqueta="¿Quién puso la plata?"
            perfiles={perfiles}
            userId={userId}
            valor={pagadoPor}
            onChange={setPagadoPor}
          />

          <CampoMonto valor={monto} onChange={setMonto} />

          <div>
            <p className="mb-1 text-sm font-medium">¿Qué fue?</p>
            <div className="mb-2 flex flex-wrap gap-2">
              {['Préstamo', 'Devolución'].map((m) => (
                <button
                  key={m}
                  type="button"
                  className="chip"
                  data-activo={descripcion === m}
                  onClick={() => setDescripcion(m)}
                >
                  {m}
                </button>
              ))}
            </div>
            <input
              className="input"
              placeholder="Préstamo, devolución, lo que sea…"
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
            />
          </div>

          <CampoFecha valor={fecha} onChange={setFecha} />

          <p className="rounded-lg bg-birome-suave p-3 text-xs text-tinta-suave lg:col-span-2">
            Va directo al saldo del mes, sin contar como gasto:{' '}
            {pagadoPor && pagadoPor !== userId ? (
              <>
                queda a favor de <span className="font-medium text-tinta">{otro?.nombre}</span>.
              </>
            ) : (
              <>
                queda a tu favor — {otro?.nombre ?? 'el otro'} te debe eso más (o vos le debés
                eso menos).
              </>
            )}{' '}
            Sirve para préstamos y para devolver de a poco.
          </p>

          <button className="btn btn-primario lg:col-span-2" disabled={guardando || ok}>
            {ok ? 'Anotado ✓' : guardando ? 'Anotando…' : 'Anotar en el saldo'}
          </button>
          {error && <p className="text-sm text-rojo lg:col-span-2">{error}</p>}
        </form>
      )}
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
