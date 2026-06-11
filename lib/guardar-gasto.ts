import type { SupabaseClient } from '@supabase/supabase-js'
import type { GastoFijo } from './types'
import { avisar } from './avisar'

/**
 * Guardado de un gasto desde el navegador: lo usan la carga rápida del
 * inicio y la pantalla Cargar. Es la misma lógica que lib/ingesta.ts
 * (WhatsApp, Forms, atajos) pero con la sesión del usuario — respeta RLS
 * en vez de usar el cliente admin.
 */
export type DatosGasto = {
  monto: number
  descripcion: string
  categoria: string | null
  fecha: string // YYYY-MM-DD
  esPersonal: boolean
  tipo: 'gasto_depto' | 'gasto_fijo'
  /** Quién puso la plata (en los que paga un tercero: quién queda debiendo). */
  pagadorId: string
  /** Regla del catálogo si la descripción corresponde a un fijo. */
  fijo?: GastoFijo | null
}

export type ResultadoGuardar =
  | { ok: true; clase: 'movimiento' | 'deuda'; id: string }
  | { ok: false; error: string }

/**
 * Qué proporción del gasto corre por cuenta del pagador.
 * Respeta la semántica del catálogo: prop_pagador 0.5 = mitades,
 * null = porcentaje del perfil. Un fijo fuera del catálogo va mitades.
 */
export function propPagador(g: {
  esPersonal: boolean
  tipo: 'gasto_depto' | 'gasto_fijo'
  fijo?: { prop_pagador?: number | null } | null
}): number | null {
  if (g.esPersonal) return 1
  if (g.tipo !== 'gasto_fijo') return null
  if (!g.fijo) return 0.5
  return g.fijo.prop_pagador != null ? Number(g.fijo.prop_pagador) : null
}

/** Parte del total que se le debe al tercero (Expensas → la mitad, a Seba). */
export function parteTercero(monto: number, fijo: { prop_tercero?: number | null }) {
  return Math.round(monto * Number(fijo.prop_tercero ?? 0.5) * 100) / 100
}

export async function guardarGasto(
  supabase: SupabaseClient,
  gasto: DatosGasto
): Promise<ResultadoGuardar> {
  const fijo = gasto.fijo ?? null

  // Lo paga un tercero (Expensas → Seba): no es un movimiento, es deuda
  if (!gasto.esPersonal && fijo?.paga_tercero) {
    const { data, error } = await supabase
      .from('deudas')
      .insert({
        descripcion: gasto.descripcion,
        acreedor_tipo: 'externo',
        acreedor_nombre: fijo.paga_tercero,
        deudor: gasto.pagadorId,
        monto_total: parteTercero(gasto.monto, fijo),
        cantidad_cuotas: 1,
        fecha_primera_cuota: gasto.fecha,
      })
      .select('id')
      .single()
    if (error) return { ok: false, error: error.message }
    avisar({ tipo: 'deuda', id: data.id })
    return { ok: true, clase: 'deuda', id: data.id }
  }

  const { data, error } = await supabase
    .from('movimientos')
    .insert({
      tipo: gasto.esPersonal ? 'gasto_depto' : gasto.tipo,
      fecha: gasto.fecha,
      descripcion: gasto.descripcion,
      monto: gasto.monto,
      pagado_por: gasto.pagadorId,
      categoria: gasto.categoria,
      // es_personal va solo cuando hace falta: lo compartido funciona
      // aunque la migración v2 todavía no se haya corrido
      ...(gasto.esPersonal
        ? { prop_pagador: 1, es_personal: true }
        : { prop_pagador: propPagador(gasto) }),
    })
    .select('id')
    .single()
  if (error) return { ok: false, error: error.message }
  if (!gasto.esPersonal) avisar({ tipo: 'gasto', id: data.id })
  return { ok: true, clase: 'movimiento', id: data.id }
}
