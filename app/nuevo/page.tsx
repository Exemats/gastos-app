'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { CATEGORIAS, type GastoFijo, type Profile } from '@/lib/types'
import { hoyISO } from '@/lib/format'
import Nav from '@/components/Nav'

export default function NuevoGasto() {
  const router = useRouter()
  const supabase = createClient()

  const [perfiles, setPerfiles] = useState<Profile[]>([])
  const [fijos, setFijos] = useState<GastoFijo[]>([])
  const [userId, setUserId] = useState<string | null>(null)

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
      const [{ data: u }, { data: p }, { data: f }] = await Promise.all([
        supabase.auth.getUser(),
        supabase.from('profiles').select('id, nombre, porcentaje'),
        supabase.from('gastos_fijos').select('*').eq('activo', true).order('nombre'),
      ])
      const uid = u.user?.id ?? null
      setUserId(uid)
      setPerfiles((p ?? []).map((x) => ({ ...x, porcentaje: Number(x.porcentaje) })))
      setFijos((f ?? []) as GastoFijo[])
      if (uid) setPagadoPor(uid)
    }
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function elegirFijo(f: GastoFijo) {
    setDescripcion(f.nombre)
    if (f.monto_estimado) setMonto(String(f.monto_estimado))
    setCategoria('servicios')
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const montoNum = Number(monto.replace(',', '.'))
    if (!montoNum || montoNum <= 0) {
      setError('Poné un monto mayor a cero.')
      return
    }
    if (!descripcion.trim()) {
      setError('Falta la descripción.')
      return
    }
    setGuardando(true)
    const { error } = await supabase.from('movimientos').insert({
      tipo,
      fecha,
      descripcion: descripcion.trim(),
      monto: montoNum,
      pagado_por: pagadoPor || userId,
      categoria,
      prop_pagador: soloMio ? 1 : null,
    })
    setGuardando(false)
    if (error) {
      setError(error.message)
      return
    }
    setOk(true)
    setTimeout(() => router.push('/'), 650)
  }

  return (
    <main className="mx-auto max-w-md px-4 pb-28 pt-6">
      <h1 className="mb-4 text-2xl">Cargar un gasto</h1>

      {/* Tipo */}
      <div className="mb-4 grid grid-cols-2 gap-2">
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

      {tipo === 'gasto_fijo' && fijos.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {fijos.map((f) => (
            <button
              key={f.id}
              type="button"
              className="chip"
              data-activo={descripcion === f.nombre}
              onClick={() => elegirFijo(f)}
            >
              {f.nombre}
            </button>
          ))}
        </div>
      )}

      <form onSubmit={guardar} className="card grid gap-4 p-5">
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="monto">
            Monto
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
            placeholder={tipo === 'gasto_fijo' ? 'Luz, gas, internet…' : 'Súper, salida, farmacia…'}
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
          />
        </div>

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

        {tipo === 'gasto_depto' && (
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
            Fecha
          </label>
          <input
            id="fecha"
            type="date"
            className="input"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
          />
        </div>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={soloMio}
            onChange={(e) => setSoloMio(e.target.checked)}
          />
          <span>
            Es 100% de quien lo pagó <span className="text-tinta-suave">(no se divide, no genera deuda)</span>
          </span>
        </label>

        <button className="btn btn-primario" disabled={guardando || ok}>
          {ok ? 'Anotado ✓' : guardando ? 'Anotando…' : 'Anotar en la libreta'}
        </button>
        {error && <p className="text-sm text-rojo">{error}</p>}
      </form>
      <Nav />
    </main>
  )
}
