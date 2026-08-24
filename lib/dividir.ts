import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Todo lo que significa "esto se reparte con un tercero" vive acá, en un
 * solo lugar. Antes había dos copias del mismo patrón (gasto del depto +
 * deuda con quien lo paga de verdad): una para los fijos del catálogo
 * (guardar-gasto.ts e ingesta.ts) y otra, distinta, para dividir una
 * deuda cargada a mano (deudas/page.tsx). Las dos vías llaman a las
 * mismas dos funciones de acá.
 */

type ResultadoCrear<T extends Record<string, unknown>> =
  | ({ ok: true } & T)
  | { ok: false; error: string }

export type DatosMovimientoConTercero = {
  tipo: 'gasto_depto' | 'gasto_fijo'
  fecha: string
  descripcion: string
  monto: number
  pagadorId: string
  categoria: string | null
  /** Proporción ya resuelta del movimiento (lo que le toca a quien carga
   * como gasto del depto, antes de descontar la parte del tercero). */
  propPagador: number
}

export type DatosTercero = {
  /** Nombre de quien paga de verdad (ej: "Seba"). */
  nombre: string
  /** Parte del total que se le debe (ej 0.5 = la mitad). */
  prop: number
  /** Quién de los dos le queda debiendo esa parte. */
  deudorId: string
}

/**
 * Crea el gasto del depto (se divide como cualquier otro, entre
 * ustedes) y, junto con él, la deuda con el tercero que lo pagó de
 * verdad, por su parte — vinculada al movimiento para poder rastrearla.
 * Es el mismo patrón de "Expensas → Seba", generalizado.
 */
export async function crearGastoConTercero(
  supabase: SupabaseClient,
  movimiento: DatosMovimientoConTercero,
  tercero: DatosTercero
): Promise<ResultadoCrear<{ movimientoId: string; deudaId: string }>> {
  const { data: mov, error } = await supabase
    .from('movimientos')
    .insert({
      tipo: movimiento.tipo,
      fecha: movimiento.fecha,
      descripcion: movimiento.descripcion,
      monto: movimiento.monto,
      pagado_por: movimiento.pagadorId,
      categoria: movimiento.categoria ?? 'servicios',
      prop_pagador: movimiento.propPagador,
    })
    .select('id')
    .single()
  if (error) return { ok: false, error: error.message }

  const { data: deuda, error: errorDeuda } = await supabase
    .from('deudas')
    .insert({
      descripcion: movimiento.descripcion,
      acreedor_tipo: 'externo',
      acreedor_nombre: tercero.nombre,
      deudor: tercero.deudorId,
      monto_total: parteDelTercero(movimiento.monto, tercero.prop),
      cantidad_cuotas: 1,
      fecha_primera_cuota: movimiento.fecha,
      movimiento_id: mov.id,
    })
    .select('id')
    .single()
  if (errorDeuda) return { ok: false, error: errorDeuda.message }

  return { ok: true, movimientoId: mov.id, deudaId: deuda.id }
}

/** Cuánto le corresponde al tercero de un monto (redondeado a centavos). */
export function parteDelTercero(monto: number, prop: number) {
  return Math.round(monto * prop * 100) / 100
}

export type SplitInterno = {
  descripcion: string
  monto: number
  cantidadCuotas: number
  fechaPrimeraCuota: string | null
  /** A quién le queda cobrando esta parte (quien cargó/financió la deuda principal). */
  acreedorId: string
  /** Quién de los dos debe esta parte. */
  deudorId: string
}

/**
 * Crea una deuda (a un tercero, o entre ustedes) y, si corresponde,
 * una segunda deuda interna vinculada por la parte de la otra persona
 * — el mismo patrón de "gasto + deuda a un tercero" de arriba, pero
 * para algo que ya es en sí mismo una deuda (compraron algo en cuotas
 * que hay que repartirse). `datosPrincipal` es el insert de la deuda
 * "real", ya armado por el formulario (dirección/tercero ya resueltos).
 */
export async function crearCuotaDividida(
  supabase: SupabaseClient,
  datosPrincipal: Record<string, unknown>,
  split: SplitInterno | null
): Promise<ResultadoCrear<{ deudaId: string; deudaVinculadaId?: string }>> {
  const { data: creada, error } = await supabase
    .from('deudas')
    .insert(datosPrincipal)
    .select('id')
    .single()
  if (error) return { ok: false, error: error.message }
  if (!split) return { ok: true, deudaId: creada.id }

  const { data: interna, error: errorInterna } = await supabase
    .from('deudas')
    .insert({
      descripcion: split.descripcion,
      monto_total: split.monto,
      cantidad_cuotas: split.cantidadCuotas,
      fecha_primera_cuota: split.fechaPrimeraCuota,
      acreedor_tipo: 'interno',
      acreedor_profile: split.acreedorId,
      deudor: split.deudorId,
      vinculo_id: creada.id,
    })
    .select('id')
    .single()
  if (errorInterna) {
    return {
      ok: false,
      error: `Se anotó la deuda, pero falló la parte vinculada: ${errorInterna.message}`,
    }
  }
  await supabase.from('deudas').update({ vinculo_id: interna.id }).eq('id', creada.id)
  return { ok: true, deudaId: creada.id, deudaVinculadaId: interna.id }
}
