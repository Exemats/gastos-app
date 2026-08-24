'use client'
import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { plata, plataExacta, fechaCorta } from '@/lib/format'
import { parsearMonto } from '@/lib/parsear-gasto'
import type { Deuda, Profile } from '@/lib/types'
import Nav from '@/components/Nav'
import Descuento, { calcularDescuento } from '@/components/Descuento'
import EditarDeuda from '@/components/EditarDeuda'
import { useRealtime } from '@/lib/use-realtime'
import { avisar } from '@/lib/avisar'
import {
  agruparDeudas,
  deudasQueDebes,
  deudasQueTeDeben,
  etiquetaAcreedor,
  etiquetaDeudor,
  type GrupoDeuda,
} from '@/lib/deudas'

export default function DeudasPage() {
  const supabase = createClient()
  const [deudas, setDeudas] = useState<Deuda[]>([])
  const [perfiles, setPerfiles] = useState<Profile[]>([])
  const [nombresFijos, setNombresFijos] = useState<string[]>([])
  const [userId, setUserId] = useState<string | null>(null)
  const [verSaldadas, setVerSaldadas] = useState(false)
  const [mostrarForm, setMostrarForm] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [esEscritorio, setEsEscritorio] = useState(false)

  useEffect(() => {
    setEsEscritorio(window.matchMedia('(min-width: 1024px)').matches)
  }, [])

  const cargar = useCallback(async () => {
    const [{ data: u }, { data: d }, { data: p }, { data: f }] = await Promise.all([
      supabase.auth.getUser(),
      supabase
        .from('deudas')
        .select('*')
        .order('activa', { ascending: false })
        .order('created_at', { ascending: false }),
      supabase.from('profiles').select('id, nombre, porcentaje'),
      supabase.from('gastos_fijos').select('paga_tercero'),
    ])
    setUserId(u.user?.id ?? null)
    setDeudas((d ?? []) as Deuda[])
    setPerfiles((p ?? []).map((x) => ({ ...x, porcentaje: Number(x.porcentaje) })))
    setNombresFijos(
      (f ?? []).map((x) => x.paga_tercero).filter((x): x is string => Boolean(x))
    )
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

  const [editando, setEditando] = useState<string | null>(null)
  const [borrando, setBorrando] = useState<string | null>(null)

  async function borrarDeuda(id: string) {
    const { error } = await supabase.from('deudas').delete().eq('id', id)
    setBorrando(null)
    if (!error) cargar()
  }

  const visibles = deudas.filter((d) => (verSaldadas ? true : d.activa))
  const debes = agruparDeudas(deudasQueDebes(visibles, userId), (d) =>
    etiquetaAcreedor(d, perfiles)
  )
  const teDeben = agruparDeudas(deudasQueTeDeben(visibles, userId), (d) =>
    etiquetaDeudor(d, perfiles)
  )

  // nombres conocidos para elegir "a quién"/"quién": el catálogo de fijos
  // con tercero (Seba) + los nombres ya usados en otras deudas
  const nombresConocidos = [
    ...new Set([
      ...nombresFijos,
      ...deudas.map((d) => d.acreedor_nombre).filter((x): x is string => Boolean(x)),
      ...deudas.map((d) => d.deudor_nombre).filter((x): x is string => Boolean(x)),
    ]),
  ]

  const hayDeudas = debes.length > 0 || teDeben.length > 0

  return (
    <main className="mx-auto max-w-md px-4 pb-28 pt-6 lg:max-w-4xl">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl">Deudas</h1>
        <button
          className="btn btn-primario !py-2 !text-sm"
          onClick={() => setMostrarForm((v) => !v)}
        >
          {mostrarForm ? 'Cerrar' : '+ Nueva'}
        </button>
      </div>

      {mostrarForm && (
        <NuevaDeudaForm
          perfiles={perfiles}
          userId={userId}
          nombresConocidos={nombresConocidos}
          onCreada={() => {
            setMostrarForm(false)
            cargar()
          }}
        />
      )}

      {cargando ? (
        <p className="text-sm text-tinta-suave">Cargando…</p>
      ) : !hayDeudas ? (
        <div className="card p-5 text-center text-sm text-tinta-suave">
          No hay deudas activas. Cuando compren algo en cuotas, o alguien les deba plata,
          anotalo acá.
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
          {debes.length > 0 && (
            <section className={teDeben.length === 0 ? 'lg:col-span-2' : ''}>
              <h2 className="mb-3 text-lg">Debés</h2>
              <div className={`grid gap-3 ${teDeben.length === 0 ? 'lg:grid-cols-2' : ''}`}>
                {debes.map((g) => (
                  <GrupoDeudas
                    key={`debes-${g.nombre}`}
                    grupo={g}
                    contexto="debes"
                    abierto={esEscritorio}
                    perfiles={perfiles}
                    editando={editando}
                    borrando={borrando}
                    onPagar={pagarCuota}
                    onReactivar={reactivar}
                    onEditar={setEditando}
                    onBorrar={borrarDeuda}
                    onPedirBorrar={setBorrando}
                    onCambio={cargar}
                  />
                ))}
              </div>
            </section>
          )}
          {teDeben.length > 0 && (
            <section className={debes.length === 0 ? 'lg:col-span-2' : ''}>
              <h2 className="mb-3 text-lg">Te deben</h2>
              <div className={`grid gap-3 ${debes.length === 0 ? 'lg:grid-cols-2' : ''}`}>
                {teDeben.map((g) => (
                  <GrupoDeudas
                    key={`tedeben-${g.nombre}`}
                    grupo={g}
                    contexto="te-deben"
                    abierto={esEscritorio}
                    perfiles={perfiles}
                    editando={editando}
                    borrando={borrando}
                    onPagar={pagarCuota}
                    onReactivar={reactivar}
                    onEditar={setEditando}
                    onBorrar={borrarDeuda}
                    onPedirBorrar={setBorrando}
                    onCambio={cargar}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
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

function GrupoDeudas({
  grupo,
  contexto,
  abierto,
  perfiles,
  editando,
  borrando,
  onPagar,
  onReactivar,
  onEditar,
  onBorrar,
  onPedirBorrar,
  onCambio,
}: {
  grupo: GrupoDeuda
  contexto: 'debes' | 'te-deben'
  abierto: boolean
  perfiles: Profile[]
  editando: string | null
  borrando: string | null
  onPagar: (d: Deuda) => void
  onReactivar: (d: Deuda) => void
  onEditar: (id: string | null) => void
  onBorrar: (id: string) => void
  onPedirBorrar: (id: string | null) => void
  onCambio: () => void
}) {
  return (
    <details className="card group p-4" open={abierto}>
      <summary className="flex cursor-pointer list-none items-baseline justify-between gap-2">
        <h3 className="font-semibold">{grupo.nombre}</h3>
        <span className="flex items-center gap-1.5 text-sm text-tinta-suave">
          {grupo.cuotaMensual > 0 && (
            <span className="num">
              <span className="font-semibold text-tinta">{plata(grupo.cuotaMensual)}</span>/mes ·
              faltan <span className="font-semibold">{plata(grupo.restante)}</span>
            </span>
          )}
          <span className="transition-transform group-open:rotate-180">▾</span>
        </span>
      </summary>
      <ul className="mt-3 grid gap-2">
        {grupo.deudas.map((d) => {
          const restante = Number(d.valor_cuota) * d.cuotas_restantes
          const pct = (d.cuota_actual / d.cantidad_cuotas) * 100
          return (
            <li key={d.id} className={`card p-3 ${d.activa ? '' : 'opacity-60'}`}>
              <div className="flex items-baseline justify-between gap-2">
                <p className="min-w-0 truncate font-semibold">{d.descripcion}</p>
                <p className="num shrink-0 text-sm text-tinta-suave">
                  {plataExacta(Number(d.valor_cuota))}
                </p>
              </div>
              <div className="mt-1 flex items-center justify-between gap-2">
                <p className="text-sm">
                  <span className="num font-semibold">
                    {d.cuota_actual}/{d.cantidad_cuotas}
                  </span>{' '}
                  {d.activa ? (
                    <>
                      · faltan <span className="num font-semibold">{plata(restante)}</span>
                    </>
                  ) : (
                    <span className="font-semibold text-verde">· saldada ✓</span>
                  )}
                </p>
                {d.activa && (
                  <button
                    className="btn btn-secundario shrink-0 !px-3 !py-1.5 !text-sm"
                    onClick={() => onPagar(d)}
                  >
                    {contexto === 'debes' ? 'Pagué' : 'Me pagó'}
                  </button>
                )}
              </div>
              <details className="group/detalle mt-1.5">
                <summary className="cursor-pointer list-none text-xs text-tinta-suave underline underline-offset-2">
                  Detalles{' '}
                  <span className="inline-block transition-transform group-open/detalle:rotate-180">
                    ▾
                  </span>
                </summary>
                <div className="mt-2 grid gap-2">
                  {d.fecha_primera_cuota && (
                    <p className="text-xs text-tinta-suave">
                      desde {fechaCorta(d.fecha_primera_cuota)}
                    </p>
                  )}
                  {d.activa && (
                    <div className="h-2 overflow-hidden rounded-full bg-birome-suave">
                      <div
                        className="h-full rounded-full bg-birome"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  )}
                  {d.cuota_actual > 0 && (
                    <button
                      className="justify-self-start text-xs text-tinta-suave underline underline-offset-2"
                      aria-label="Deshacer la última cuota pagada"
                      onClick={() => onReactivar(d)}
                    >
                      Deshacer la última cuota
                    </button>
                  )}
                  <div className="flex items-center gap-3">
                    <button
                      className="text-xs text-tinta-suave underline underline-offset-2 hover:text-birome"
                      onClick={() => {
                        onEditar(editando === d.id ? null : d.id)
                        onPedirBorrar(null)
                      }}
                    >
                      Corregir
                    </button>
                    {borrando === d.id ? (
                      <span className="flex items-center gap-2 text-xs">
                        <span>¿Borrar?</span>
                        <button
                          className="rounded bg-rojo px-2 py-1 font-semibold text-white"
                          onClick={() => onBorrar(d.id)}
                        >
                          Sí
                        </button>
                        <button
                          className="rounded border border-linea px-2 py-1"
                          onClick={() => onPedirBorrar(null)}
                        >
                          No
                        </button>
                      </span>
                    ) : (
                      <button
                        className="text-xs text-tinta-suave underline underline-offset-2 hover:text-rojo"
                        onClick={() => {
                          onPedirBorrar(d.id)
                          onEditar(null)
                        }}
                      >
                        Borrar
                      </button>
                    )}
                  </div>
                  {editando === d.id && (
                    <EditarDeuda
                      deuda={d}
                      perfiles={perfiles}
                      onDone={() => {
                        onEditar(null)
                        onCambio()
                      }}
                      onCancel={() => onEditar(null)}
                    />
                  )}
                </div>
              </details>
            </li>
          )
        })}
      </ul>
    </details>
  )
}

function SelectorTercero({
  etiqueta,
  nombresConocidos,
  valor,
  onChange,
}: {
  etiqueta: string
  nombresConocidos: string[]
  valor: string
  onChange: (v: string) => void
}) {
  const [libre, setLibre] = useState(valor !== '' && !nombresConocidos.includes(valor))
  return (
    <div>
      <p className="mb-1 text-sm font-medium">{etiqueta}</p>
      <div className="flex flex-wrap gap-2">
        {nombresConocidos.map((n) => (
          <button
            key={n}
            type="button"
            className="chip"
            data-activo={!libre && valor === n}
            onClick={() => {
              setLibre(false)
              onChange(n)
            }}
          >
            {n}
          </button>
        ))}
        <button
          type="button"
          className="chip"
          data-activo={libre}
          onClick={() => {
            setLibre(true)
            onChange('')
          }}
        >
          + Otro
        </button>
      </div>
      {libre && (
        <input
          className="input mt-2"
          placeholder="Nombre…"
          value={valor}
          onChange={(e) => onChange(e.target.value)}
          autoFocus
        />
      )}
    </div>
  )
}

function NuevaDeudaForm({
  perfiles,
  userId,
  nombresConocidos,
  onCreada,
}: {
  perfiles: Profile[]
  userId: string | null
  nombresConocidos: string[]
  onCreada: () => void
}) {
  const supabase = createClient()
  const [direccion, setDireccion] = useState<'debemos' | 'nos_deben'>('debemos')
  const [descripcion, setDescripcion] = useState('')
  const [personaInterna, setPersonaInterna] = useState(userId ?? '')
  const [terceroTipo, setTerceroTipo] = useState<'externo' | 'interno'>('externo')
  const [terceroNombre, setTerceroNombre] = useState('')
  const [modoMonto, setModoMonto] = useState<'total' | 'cuota'>('total')
  const [montoTotal, setMontoTotal] = useState('')
  const [cuotas, setCuotas] = useState('')
  // solo aplica cuando "debemos" a un tercero: la parte del otro queda
  // como una segunda deuda interna (cuota entre ustedes), automática
  const [division, setDivision] = useState<'propio' | 'partes' | 'mitad'>('propio')
  const [primeraCuota, setPrimeraCuota] = useState('')
  const [conDescuento, setConDescuento] = useState(false)
  const [descuentoPct, setDescuentoPct] = useState('')
  const [topeReintegro, setTopeReintegro] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (userId && !personaInterna) setPersonaInterna(userId)
  }, [userId, personaInterna])

  const otro = perfiles.find((p) => p.id !== personaInterna)

  const ingresado = parsearMonto(montoTotal.trim()) ?? 0
  const nCuotas = parseInt(cuotas, 10) || 0
  const montoBase = modoMonto === 'cuota' ? ingresado * nCuotas : ingresado

  function cambiarDireccion(d: 'debemos' | 'nos_deben') {
    setDireccion(d)
    setTerceroTipo('externo')
    setTerceroNombre('')
    setDivision('propio')
  }

  const puedeDividir = direccion === 'debemos' && terceroTipo === 'externo' && Boolean(otro)
  const propOtroDivision = division === 'mitad' ? 0.5 : otro?.porcentaje ?? 0.5
  const montoOtroDivision =
    puedeDividir && division !== 'propio'
      ? Math.round(montoBase * propOtroDivision * 100) / 100
      : 0

  async function crear(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const n = parseInt(cuotas, 10)
    if (!descripcion.trim()) return setError('Falta la descripción.')
    if (!n || n < 1) return setError('Poné la cantidad de cuotas.')
    if (!ingresado || ingresado <= 0)
      return setError(
        modoMonto === 'cuota' ? 'Poné el valor de cada cuota.' : 'Poné el monto total.'
      )
    let monto = montoBase
    if (conDescuento) {
      const d = calcularDescuento(monto, descuentoPct, topeReintegro)
      if (!d) return setError('Poné el % de descuento (o destildá el descuento).')
      monto = d.neto
    }
    if (terceroTipo === 'externo' && !terceroNombre.trim())
      return setError(direccion === 'debemos' ? '¿A quién se le debe?' : '¿Quién debe?')
    if (terceroTipo === 'interno' && !otro)
      return setError('Todavía no está el perfil de la otra persona.')

    const datos: Record<string, unknown> = {
      descripcion: descripcion.trim(),
      monto_total: monto,
      cantidad_cuotas: n,
      fecha_primera_cuota: primeraCuota || null,
    }
    if (direccion === 'debemos') {
      datos.deudor = personaInterna
      datos.acreedor_tipo = terceroTipo
      datos.acreedor_nombre = terceroTipo === 'externo' ? terceroNombre.trim() : null
      datos.acreedor_profile = terceroTipo === 'interno' ? otro?.id ?? null : null
    } else {
      datos.acreedor_tipo = 'interno'
      datos.acreedor_profile = personaInterna
      datos.acreedor_nombre = null
      if (terceroTipo === 'interno') {
        datos.deudor = otro?.id ?? null
      } else {
        // requiere migración v3 (deudor_tipo / deudor_nombre / deudor nulable)
        datos.deudor = null
        datos.deudor_tipo = 'externo'
        datos.deudor_nombre = terceroNombre.trim()
      }
    }

    setGuardando(true)
    const { data: creada, error } = await supabase
      .from('deudas')
      .insert(datos)
      .select('id')
      .single()
    if (error) {
      setGuardando(false)
      setError(error.message)
      return
    }
    if (creada) avisar({ tipo: 'deuda', id: creada.id })

    // se divide con el otro: además de la deuda real, una interna por su
    // parte — la misma lógica que ya suma al saldo del mes en /resumen
    if (puedeDividir && division !== 'propio' && otro) {
      const montoOtro = Math.round(monto * propOtroDivision * 100) / 100
      const { data: creadaInterna, error: errorInterna } = await supabase
        .from('deudas')
        .insert({
          descripcion: `${descripcion.trim()} — parte de ${otro.nombre}`,
          monto_total: montoOtro,
          cantidad_cuotas: n,
          fecha_primera_cuota: primeraCuota || null,
          acreedor_tipo: 'interno',
          acreedor_profile: personaInterna,
          deudor: otro.id,
        })
        .select('id')
        .single()
      setGuardando(false)
      if (errorInterna) {
        setError(
          `Se anotó la deuda, pero falló la parte de ${otro.nombre}: ${errorInterna.message}`
        )
        return
      }
      if (creadaInterna) avisar({ tipo: 'deuda', id: creadaInterna.id })
    } else {
      setGuardando(false)
    }
    onCreada()
  }

  return (
    <form onSubmit={crear} className="card mb-4 grid gap-3 border-birome p-4">
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          className="chip text-center"
          data-activo={direccion === 'debemos'}
          onClick={() => cambiarDireccion('debemos')}
        >
          Debemos
        </button>
        <button
          type="button"
          className="chip text-center"
          data-activo={direccion === 'nos_deben'}
          onClick={() => cambiarDireccion('nos_deben')}
        >
          Nos deben
        </button>
      </div>

      <input
        className="input"
        placeholder="Qué es (ej: Zapatillas Vans, Expensas…)"
        value={descripcion}
        onChange={(e) => setDescripcion(e.target.value)}
      />

      <div>
        <p className="mb-1 text-sm font-medium">
          {direccion === 'debemos' ? '¿Quién de los dos debe?' : '¿A quién de los dos le deben?'}
        </p>
        <div className="grid grid-cols-2 gap-2">
          {perfiles.map((p) => (
            <button
              key={p.id}
              type="button"
              className="chip text-center"
              data-activo={personaInterna === p.id}
              onClick={() => setPersonaInterna(p.id)}
            >
              {p.nombre}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          className="chip text-center"
          data-activo={terceroTipo === 'externo'}
          onClick={() => setTerceroTipo('externo')}
        >
          {direccion === 'debemos' ? 'A un tercero' : 'Un tercero'}
        </button>
        <button
          type="button"
          className="chip text-center"
          data-activo={terceroTipo === 'interno'}
          onClick={() => setTerceroTipo('interno')}
        >
          Entre nosotros
        </button>
      </div>

      {terceroTipo === 'externo' ? (
        <SelectorTercero
          etiqueta={direccion === 'debemos' ? '¿A quién?' : '¿Quién debe?'}
          nombresConocidos={nombresConocidos}
          valor={terceroNombre}
          onChange={setTerceroNombre}
        />
      ) : (
        <p className="text-sm text-tinta-suave">
          {direccion === 'debemos' ? 'Acreedor' : 'Deudor'}:{' '}
          <span className="font-semibold">{otro?.nombre ?? '—'}</span>
        </p>
      )}

      {puedeDividir && (
        <div>
          <p className="mb-1 text-sm font-medium">¿Cómo se divide?</p>
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              className="chip text-center"
              data-activo={division === 'propio'}
              onClick={() => setDivision('propio')}
            >
              100% mío
            </button>
            <button
              type="button"
              className="chip text-center"
              data-activo={division === 'partes'}
              onClick={() => setDivision('partes')}
            >
              Sus partes
            </button>
            <button
              type="button"
              className="chip text-center"
              data-activo={division === 'mitad'}
              onClick={() => setDivision('mitad')}
            >
              50/50
            </button>
          </div>
          <p className="mt-1.5 text-xs text-tinta-suave">
            {division === 'propio'
              ? 'Corre entera por tu cuenta: no genera nada entre ustedes.'
              : `Se anota entera con ${terceroNombre || 'el tercero'}, y además queda ` +
                `una cuota interna: ${otro?.nombre ?? 'el otro'} te debe su parte` +
                (montoOtroDivision > 0 ? ` (${plata(montoOtroDivision)} en total).` : '.')}
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          className="chip text-center"
          data-activo={modoMonto === 'total'}
          onClick={() => setModoMonto('total')}
        >
          Sé el total
        </button>
        <button
          type="button"
          className="chip text-center"
          data-activo={modoMonto === 'cuota'}
          onClick={() => setModoMonto('cuota')}
        >
          Sé el valor de la cuota
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input
          className="input num"
          inputMode="decimal"
          placeholder={modoMonto === 'cuota' ? 'Valor de cada cuota $' : 'Monto total $'}
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
      {modoMonto === 'cuota' && montoBase > 0 && (
        <p className="text-xs text-tinta-suave">
          Total: <span className="num font-medium text-tinta">{plata(montoBase)}</span>
        </p>
      )}
      <Descuento
        activo={conDescuento}
        onActivo={setConDescuento}
        pct={descuentoPct}
        onPct={setDescuentoPct}
        tope={topeReintegro}
        onTope={setTopeReintegro}
        bruto={montoBase}
      />
      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor="primera">
          Primera cuota (opcional)
        </label>
        <input
          id="primera"
          type="date"
          className="input"
          value={primeraCuota}
          onChange={(e) => setPrimeraCuota(e.target.value)}
        />
      </div>
      <button className="btn btn-primario" disabled={guardando}>
        {guardando ? 'Creando…' : 'Crear deuda'}
      </button>
      {error && <p className="text-sm text-rojo">{error}</p>}
    </form>
  )
}
