'use client'
import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { CATEGORIAS, type GastoFijo, type Profile } from '@/lib/types'
import { hoyISO, nombreMes, plata } from '@/lib/format'
import { parsearGasto, parsearMonto, sinAcentos, coincideNombre } from '@/lib/parsear-gasto'
import { errorLegible } from '@/lib/errores'
import Nav from '@/components/Nav'

function NuevoGastoForm() {
  const router = useRouter()
  const params = useSearchParams()
  const supabase = createClient()

  const [perfiles, setPerfiles] = useState<Profile[]>([])
  const [fijos, setFijos] = useState<GastoFijo[]>([])
  const [sugerencias, setSugerencias] = useState<string[]>([])
  const [userId, setUserId] = useState<string | null>(null)

  const [ambito, setAmbito] = useState<'compartido' | 'personal'>(
    params.get('ambito') === 'personal' ? 'personal' : 'compartido'
  )
  const [tipo, setTipo] = useState<'gasto_depto' | 'gasto_fijo'>('gasto_depto')
  const [monto, setMonto] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [fecha, setFecha] = useState(hoyISO())
  const [pagadoPor, setPagadoPor] = useState('')
  const [categoria, setCategoria] = useState<string | null>(null)
  const [soloMio, setSoloMio] = useState(false)

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
          .select('descripcion')
          .order('created_at', { ascending: false })
          .limit(200),
      ])
      const uid = u.user?.id ?? null
      const perfilesOk = (p ?? []).map((x) => ({ ...x, porcentaje: Number(x.porcentaje) }))
      const fijosOk = (f ?? []) as GastoFijo[]
      setUserId(uid)
      setPerfiles(perfilesOk)
      setFijos(fijosOk)
      // autocompletado con lo que ya cargaron otras veces
      setSugerencias([
        ...new Set((movs ?? []).map((m) => String(m.descripcion).trim())),
      ].slice(0, 40))
      if (uid) setPagadoPor(uid)

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
          if (r.gasto.esPersonal) setAmbito('personal')
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
  }

  const esPersonal = ambito === 'personal'
  // el fijo elegido se deriva de la descripción (así no queda colgado si la editan)
  const fijoElegido =
    tipo === 'gasto_fijo'
      ? fijos.find((f) => coincideNombre(descripcion, f.nombre)) ?? null
      : null
  const esTercero = Boolean(!esPersonal && fijoElegido?.paga_tercero)
  const montoNum = parsearMonto(monto.trim()) ?? 0
  const parteTercero = montoNum * Number(fijoElegido?.prop_tercero ?? 0.5)

  const yo = perfiles.find((p) => p.id === userId)
  const etiquetaPartes = perfiles.length === 2
    ? `${Math.round(perfiles[0].porcentaje * 100)}/${Math.round(perfiles[1].porcentaje * 100)}`
    : 'según sus partes'

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

    if (esTercero && fijoElegido?.paga_tercero) {
      // Expensas y similares: no es un movimiento, es deuda con el tercero
      const { error } = await supabase.from('deudas').insert({
        descripcion: descripcion.trim(),
        acreedor_tipo: 'externo',
        acreedor_nombre: fijoElegido.paga_tercero,
        deudor: userId,
        monto_total: Math.round(montoFinal * Number(fijoElegido.prop_tercero ?? 0.5) * 100) / 100,
        cantidad_cuotas: 1,
        fecha_primera_cuota: fecha,
      })
      setGuardando(false)
      if (error) {
        setError(errorLegible(error.message))
        return
      }
      setOk(true)
      setTimeout(() => router.push('/deudas'), 650)
      return
    }

    const { error } = await supabase.from('movimientos').insert({
      tipo: esPersonal ? 'gasto_depto' : tipo,
      fecha,
      descripcion: descripcion.trim(),
      monto: montoFinal,
      pagado_por: esPersonal ? userId : pagadoPor || userId,
      categoria,
      // es_personal va solo cuando hace falta: lo compartido funciona
      // aunque la migración v2 todavía no se haya corrido
      ...(esPersonal
        ? { prop_pagador: 1, es_personal: true }
        : {
            prop_pagador: soloMio
              ? 1
              : tipo === 'gasto_fijo'
                ? Number(fijoElegido?.prop_pagador ?? 0.5) // servicios: mitad y mitad
                : null, // gastos del depto: porcentaje del perfil
          }),
    })
    setGuardando(false)
    if (error) {
      setError(errorLegible(error.message))
      return
    }
    setOk(true)
    setTimeout(() => router.push(esPersonal ? '/personal' : '/'), 650)
  }

  return (
    <main className="mx-auto max-w-md px-4 pb-28 pt-6 lg:max-w-lg">
      <h1 className="mb-4 text-2xl">Cargar un gasto</h1>

      {/* Ámbito: compartido vs personal */}
      <div className="mb-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          className="chip text-center"
          data-activo={!esPersonal}
          onClick={() => setAmbito('compartido')}
        >
          Compartido
        </button>
        <button
          type="button"
          className="chip text-center"
          data-activo={esPersonal}
          onClick={() => setAmbito('personal')}
        >
          Personal 🔒
        </button>
      </div>

      {esPersonal ? (
        <p className="mb-4 text-sm text-tinta-suave">
          No se divide, no toca el saldo y solo vos lo ves.
        </p>
      ) : (
        <>
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
            {tipo === 'gasto_fijo'
              ? 'Los servicios se dividen mitad y mitad.'
              : `Se divide ${etiquetaPartes} según sus partes.`}
          </p>
        </>
      )}

      {!esPersonal && tipo === 'gasto_fijo' && fijos.length > 0 && (
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
              esPersonal
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
              <span className="num font-semibold">{plata(parteTercero)}</span> — como deuda
              con {fijoElegido.paga_tercero}, junto a las demás.
            </p>
            <p className="mt-1 text-xs text-tinta-suave">
              Cuando se la pagues, la tachás en Cuotas ("Pagué una cuota").
            </p>
          </div>
        ) : (
          !esPersonal && (
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

        {!esTercero && (esPersonal || tipo === 'gasto_depto') && (
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
          <label className="mb-1 block text-sm font-medium" htmlFor="fecha">
            {esTercero ? 'Fecha (primera y única cuota)' : 'Fecha'}
          </label>
          <input
            id="fecha"
            type="date"
            className="input"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
          />
        </div>

        {!esPersonal && !esTercero && (
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={soloMio}
              onChange={(e) => setSoloMio(e.target.checked)}
            />
            <span>
              Es 100% de quien lo pagó{' '}
              <span className="text-tinta-suave">(no se divide, no genera deuda)</span>
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
