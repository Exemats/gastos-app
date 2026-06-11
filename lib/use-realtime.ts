'use client'
import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'

/**
 * Refresco en tiempo real: cuando el otro carga/edita/tacha algo,
 * esta pantalla se entera sola (Supabase Realtime, respeta RLS).
 * El callback se debounce-a para no recargar mil veces por ráfaga.
 */
export function useRealtime(onCambio: () => void) {
  const ref = useRef(onCambio)
  ref.current = onCambio

  useEffect(() => {
    const supabase = createClient()
    let timer: ReturnType<typeof setTimeout> | null = null
    const ping = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => ref.current(), 400)
    }
    const canal = supabase
      .channel('cambios-libreta')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'movimientos' }, ping)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deudas' }, ping)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meses_saldados' }, ping)
      .subscribe()
    return () => {
      if (timer) clearTimeout(timer)
      supabase.removeChannel(canal)
    }
  }, [])
}
