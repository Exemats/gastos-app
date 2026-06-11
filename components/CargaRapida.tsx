'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { parsearGasto, coincideNombre } from '@/lib/parsear-gasto'
import { guardarGasto, parteTercero, propPagador } from '@/lib/guardar-gasto'
import { errorLegible } from '@/lib/errores'
import { plata, hoyISO, nombreMes } from '@/lib/format'
import type { GastoFijo, Profile } from '@/lib/types'

/**
 * Carga rápida del inicio: un renglón de texto libre y Enter.
 * Entiende lo mismo que el bot ("12500 súper", "luz 45000",
 * "personal 8000 gym", "vicky 9000 farmacia"); los fijos del catálogo
 * se detectan por nombre y aplican su regla solos. Con deshacer.
 */
export default function CargaRapida({
  userId,
  perfiles,
  fijos,
}: {
  userId: string
  perfiles: Profile[]
  fijos: GastoFijo[]
}) {
  const router = useRouter()
  const supabase = createClient()
  const [texto, setTexto] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [hecho, setHecho] = useState<{
    clase: 'movimiento' | 'deuda'
    id: string
    mensaje: string
  } | null>(null)
  const [deshaciendo, setDeshaciendo] = useState(false)

  async function anotar(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setHecho(null)
    const r = parsearGasto(texto, perfiles.map((p) => p.nombre))
    if (!r.ok) {
      setError(r.error)
      return
    }
    const g = r.gasto
    const nombrado = g.pagadorNombre
      ? perfiles.find((p) => p.nombre === g.pagadorNombre)
      : null
    const pagador = nombrado ?? perfiles.find((p) => p.id === userId)
    if (!pagador) {
      setError('No encontré tu perfil. Recargá la página.')
      return
    }

    // fijos del catálogo: se detectan por nombre y aplican su regla solos
    const fijo =
      g.esPersonal || g.esAjuste
        ? null
        : fijos.find((f) => coincideNombre(g.descripcion, f.nombre)) ?? null
    const fecha = hoyISO()
    const descripcion = fijo?.paga_tercero
      ? `${g.descripcion} ${nombreMes(fecha.slice(0, 7))}`
      : g.descripcion
    const tipo = fijo ? 'gasto_fijo' : g.tipo
    // lo personal va siempre a tu sección (RLS no deja cargarle al otro)
    const pagadorId = g.esPersonal ? userId : pagador.id

    setGuardando(true)
    const res = await guardarGasto(supabase, {
      monto: g.monto,
      descripcion,
      categoria: g.categoria,
      fecha,
      esPersonal: g.esPersonal,
      mitad: g.esMitad,
      esAjuste: g.esAjuste,
      tipo,
      pagadorId,
      fijo,
    })
    setGuardando(false)
    if (!res.ok) {
      setError(errorLegible(res.error))
      return
    }

    const mensaje =
      res.clase === 'deuda' && fijo?.paga_tercero
        ? `Anotado ✓ ${descripcion}: ${plata(parteTercero(g.monto, fijo))} como deuda con ${fijo.paga_tercero}.`
        : g.esAjuste
          ? `Anotado ✓ ${plata(g.monto)} — ${descripcion} (directo al saldo, puso ${pagador.nombre})`
          : `Anotado ✓ ${plata(g.monto)} — ${descripcion} (${etiquetaDivision(g.esPersonal, g.esMitad, tipo, fijo)}, pagó ${pagador.nombre})`
    setTexto('')
    setHecho({ clase: res.clase, id: res.id, mensaje })
    router.refresh()
  }

  async function deshacer() {
    if (!hecho || deshaciendo) return
    setDeshaciendo(true)
    const { error } = await supabase
      .from(hecho.clase === 'deuda' ? 'deudas' : 'movimientos')
      .delete()
      .eq('id', hecho.id)
    setDeshaciendo(false)
    if (error) {
      setError(errorLegible(error.message))
      return
    }
    setHecho(null)
    router.refresh()
  }

  return (
    <section className="card mb-4 p-4">
      <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-tinta-suave">
        Carga rápida
      </p>
      <form onSubmit={anotar} className="flex gap-2">
        <input
          className="input !py-2.5"
          placeholder="12500 súper · presté 50000 · personal 8000 gym"
          aria-label="Carga rápida: monto y descripción"
          enterKeyHint="send"
          value={texto}
          onChange={(e) => {
            setTexto(e.target.value)
            if (error) setError('')
            if (hecho) setHecho(null)
          }}
        />
        <button
          className="btn btn-primario shrink-0 !px-4"
          disabled={guardando || !texto.trim()}
        >
          {guardando ? '…' : 'Anotar'}
        </button>
      </form>
      {error && (
        <p className="mt-2 text-xs text-rojo">
          {error}{' '}
          <Link
            href={`/nuevo?texto=${encodeURIComponent(texto)}`}
            className="font-medium text-birome underline underline-offset-2"
          >
            Cargar con el formulario
          </Link>
        </p>
      )}
      {hecho && (
        <p className="mt-2 text-xs font-medium text-verde">
          {hecho.mensaje}{' '}
          <button
            type="button"
            className="font-normal text-tinta-suave underline underline-offset-2"
            disabled={deshaciendo}
            onClick={deshacer}
          >
            {deshaciendo ? 'Deshaciendo…' : 'Deshacer'}
          </button>
        </p>
      )}
    </section>
  )
}

function etiquetaDivision(
  esPersonal: boolean,
  mitad: boolean,
  tipo: 'gasto_depto' | 'gasto_fijo',
  fijo: GastoFijo | null
) {
  if (esPersonal) return 'personal 🔒'
  const prop = propPagador({ esPersonal, tipo, fijo, mitad })
  if (prop == null) return 'se divide según sus partes'
  if (prop === 0.5) return 'mitad y mitad'
  return `${Math.round(prop * 100)}% del pagador`
}
