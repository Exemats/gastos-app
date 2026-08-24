import type { SupabaseClient } from '@supabase/supabase-js'
import type { GastoFijo, Profile } from './types'
import { avisar } from './avisar'
import { crearGastoConTercero, parteDelTercero } from './dividir'

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
  /** Mitad y mitad elegido a mano (más allá de la regla del catálogo). */
  mitad?: boolean
  /** Préstamo o devolución: plata directa entre los dos, va al saldo del mes. */
  esAjuste?: boolean
  /** División ya resuelta por el usuario (el formulario): tiene la última
   * palabra. undefined = inferir de tipo/fijo/mitad. */
  prop?: number | null
  tipo: 'gasto_depto' | 'gasto_fijo'
  /** Quién puso la plata (en los que paga un tercero: quién queda debiendo). */
  pagadorId: string
  /** Regla del catálogo si la descripción corresponde a un fijo. */
  fijo?: GastoFijo | null
}

export type ResultadoGuardar =
  | { ok: true; clase: 'movimiento' | 'deuda'; id: string; deudaId?: string }
  | { ok: false; error: string }

/**
 * Qué proporción del gasto corre por cuenta del pagador.
 * Personal = todo suyo; "mitad" elegido a mano gana sobre el catálogo;
 * el catálogo dice 0.5 = mitades y null = porcentaje del perfil;
 * un fijo fuera del catálogo va mitades.
 */
export function propPagador(g: {
  esPersonal: boolean
  tipo: 'gasto_depto' | 'gasto_fijo'
  fijo?: { prop_pagador?: number | null } | null
  mitad?: boolean
}): number | null {
  if (g.esPersonal) return 1
  if (g.mitad) return 0.5
  if (g.tipo !== 'gasto_fijo') return null
  if (!g.fijo) return 0.5
  return g.fijo.prop_pagador != null ? Number(g.fijo.prop_pagador) : null
}

/** Parte del total que se le debe al tercero (Expensas → la mitad, a Seba). */
export function parteTercero(monto: number, fijo: { prop_tercero?: number | null }) {
  return parteDelTercero(monto, Number(fijo.prop_tercero ?? 0.5))
}

/**
 * Resuelve la proporción a GUARDAR en la fila: nunca null. Si hay una
 * regla explícita (personal, mitad, catálogo) se usa esa; si no ("según
 * sus partes"), se congela el % del perfil del pagador en este momento,
 * en vez de dejarlo en null para que quede "flotando" contra el % que el
 * perfil tenga el día que se lea. Así cada movimiento queda auditable
 * para siempre, aunque el % del perfil cambie más adelante.
 */
function resolverProp(
  g: Parameters<typeof propPagador>[0],
  pagadorId: string,
  perfiles: Pick<Profile, 'id' | 'porcentaje'>[]
): number {
  const explicita = propPagador(g)
  if (explicita != null) return explicita
  return perfiles.find((p) => p.id === pagadorId)?.porcentaje ?? 0.5
}

export async function guardarGasto(
  supabase: SupabaseClient,
  gasto: DatosGasto,
  perfiles: Pick<Profile, 'id' | 'porcentaje'>[]
): Promise<ResultadoGuardar> {
  const fijo = gasto.fijo ?? null

  // Préstamo o devolución: plata directa entre los dos. prop_pagador = 0
  // (todo lo puesto es "de más") y es_prestamo = true: cuenta en el neto
  // del mes pero no como gasto.
  if (gasto.esAjuste) {
    const { data, error } = await supabase
      .from('movimientos')
      .insert({
        tipo: 'gasto_depto',
        fecha: gasto.fecha,
        descripcion: gasto.descripcion,
        monto: gasto.monto,
        pagado_por: gasto.pagadorId,
        categoria: null,
        prop_pagador: 0,
        es_prestamo: true,
      })
      .select('id')
      .single()
    if (error) return { ok: false, error: error.message }
    avisar({ tipo: 'gasto', id: data.id })
    return { ok: true, clase: 'movimiento', id: data.id }
  }

  // Lo paga un tercero (Expensas → Seba): se anota igual el gasto del
  // depto (entra al saldo y a las estadísticas como cualquier servicio)
  // y además la parte de quien le queda debiendo (tercero_deudor, o
  // quien carga si no está fijado) se anota como deuda con el tercero.
  if (!gasto.esPersonal && fijo?.paga_tercero) {
    const r = await crearGastoConTercero(
      supabase,
      {
        tipo: gasto.tipo,
        fecha: gasto.fecha,
        descripcion: gasto.descripcion,
        monto: gasto.monto,
        pagadorId: gasto.pagadorId,
        categoria: gasto.categoria,
        propPagador: gasto.prop ?? resolverProp(gasto, gasto.pagadorId, perfiles),
      },
      {
        nombre: fijo.paga_tercero,
        prop: Number(fijo.prop_tercero ?? 0.5),
        deudorId: fijo.tercero_deudor ?? gasto.pagadorId,
      }
    )
    if (!r.ok) return r
    avisar({ tipo: 'gasto', id: r.movimientoId })
    avisar({ tipo: 'deuda', id: r.deudaId })
    return { ok: true, clase: 'movimiento', id: r.movimientoId, deudaId: r.deudaId }
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
        : { prop_pagador: gasto.prop ?? resolverProp(gasto, gasto.pagadorId, perfiles) }),
    })
    .select('id')
    .single()
  if (error) return { ok: false, error: error.message }
  if (!gasto.esPersonal) avisar({ tipo: 'gasto', id: data.id })
  return { ok: true, clase: 'movimiento', id: data.id }
}
