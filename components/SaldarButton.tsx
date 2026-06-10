'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { plata, hoyISO } from '@/lib/format'

/**
 * Registra un "pago de saldo": el que debe le pasa la plata al otro y
 * se anota un movimiento con prop_pagador = 0 (todo lo que puso fue
 * de la parte del otro), lo que lleva el balance a cero sin tocar el
 * esquema. Queda en el historial con categoría 'ajuste'.
 */
export default function SaldarButton({
  monto,
  deudorId,
  deudorEsUsuario,
  nombreOtro,
}: {
  monto: number
  deudorId: string
  deudorEsUsuario: boolean
  nombreOtro: string
}) {
  const [confirmando, setConfirmando] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  async function saldar() {
    setGuardando(true)
    const { error } = await supabase.from('movimientos').insert({
      tipo: 'gasto_depto',
      fecha: hoyISO(),
      descripcion: 'Pago de saldo',
      monto: Math.round(monto * 100) / 100,
      pagado_por: deudorId,
      prop_pagador: 0,
      categoria: 'ajuste',
    })
    setGuardando(false)
    setConfirmando(false)
    if (!error) router.refresh()
  }

  if (!confirmando) {
    return (
      <button
        onClick={() => setConfirmando(true)}
        className="mt-3 text-sm font-medium text-birome underline underline-offset-2"
      >
        {deudorEsUsuario
          ? `Ya le pagué a ${nombreOtro} — saldar`
          : `${nombreOtro} ya me pagó — saldar`}
      </button>
    )
  }

  return (
    <div className="mt-3 rounded-lg bg-birome-suave p-3 text-sm">
      <p>
        Se anota un pago de <span className="num font-semibold">{plata(monto)}</span> y
        el saldo queda en cero. ¿Confirmás?
      </p>
      <div className="mt-2 flex gap-2">
        <button className="btn btn-primario !py-2 !text-sm" disabled={guardando} onClick={saldar}>
          {guardando ? 'Anotando…' : 'Sí, saldar'}
        </button>
        <button className="btn btn-secundario !py-2 !text-sm" onClick={() => setConfirmando(false)}>
          Cancelar
        </button>
      </div>
    </div>
  )
}
