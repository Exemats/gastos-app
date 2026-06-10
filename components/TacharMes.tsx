'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { plata, nombreMes } from '@/lib/format'
import { errorLegible } from '@/lib/errores'

/**
 * El "tachado" del cierre mensual: ya se transfirió la diferencia del mes,
 * se marca como saldado en meses_saldados y deja de contar como pendiente.
 * No registra ningún movimiento de plata.
 */
export default function TacharMes({
  mes,
  monto,
  prominente = false,
  onDone,
}: {
  mes: string
  /** Neto del mes (absoluto): lo que se transfirió. Queda como referencia. */
  monto: number
  /** true: botón grande (Resumen). false: link chico (filas del dashboard). */
  prominente?: boolean
  onDone?: () => void
}) {
  const [confirmando, setConfirmando] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()
  const supabase = createClient()

  async function tachar() {
    setGuardando(true)
    setError('')
    const {
      data: { user },
    } = await supabase.auth.getUser()
    const { error } = await supabase.from('meses_saldados').upsert(
      {
        mes,
        monto: Math.round(monto * 100) / 100,
        saldado_por: user?.id ?? null,
      },
      { onConflict: 'mes' }
    )
    setGuardando(false)
    if (error) {
      setError(errorLegible(error.message))
      return
    }
    setConfirmando(false)
    if (onDone) onDone()
    else router.refresh()
  }

  if (!confirmando) {
    return (
      <span className="inline-flex flex-col items-end gap-1">
        <button
          onClick={() => setConfirmando(true)}
          className={
            prominente
              ? 'btn btn-primario !py-2 !text-sm'
              : 'text-xs font-medium text-birome underline underline-offset-2'
          }
        >
          {prominente ? `✓ Ya transferimos — tachar ${nombreMes(mes)}` : '✓ tachar'}
        </button>
        {error && <span className="max-w-55 text-right text-xs text-rojo">{error}</span>}
      </span>
    )
  }

  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-1.5 text-xs">
      <span>
        ¿Se transfirieron <span className="num font-semibold">{plata(monto)}</span>?
      </span>
      <button
        className="rounded bg-birome px-2 py-1 font-semibold text-white"
        disabled={guardando}
        onClick={tachar}
      >
        {guardando ? '…' : 'Sí, tachar'}
      </button>
      <button
        className="rounded border border-linea px-2 py-1"
        onClick={() => setConfirmando(false)}
      >
        No
      </button>
    </span>
  )
}
