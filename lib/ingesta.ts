import { createAdminClient } from './supabase/admin'
import {
  parsearGasto,
  parsearMonto,
  normalizarCategoria,
  sinAcentos,
  coincideNombre,
} from './parsear-gasto'
import { hoyArgentina, nombreMes, plata } from './format'
import { propPagador } from './guardar-gasto'
import { crearGastoConTercero, parteDelTercero } from './dividir'
import { avisarMovimiento, avisarDeuda } from './avisos'

/**
 * Lógica común de carga de gastos desde afuera de la app
 * (Google Forms, WhatsApp, atajos del celu). Resuelve quién pagó,
 * inserta el movimiento y devuelve un mensaje listo para responder.
 */
export type Entrada = {
  /** Texto libre estilo "12500 súper" (tiene prioridad sobre los campos sueltos). */
  texto?: string
  monto?: number | string
  descripcion?: string
  categoria?: string | null
  personal?: boolean
  fecha?: string | null
  /** Nombre del pagador ('Mati' / 'Vicky'), p. ej. desde el form. */
  quienNombre?: string | null
  /** Teléfono del remitente (WhatsApp); se matchea contra profiles.telefono. */
  telefono?: string | null
}

const soloDigitos = (s: string) => s.replace(/\D/g, '')

export async function registrarGasto(
  entrada: Entrada
): Promise<{ ok: boolean; mensaje: string }> {
  const supabase = createAdminClient()
  const { data: perfiles, error: errorPerfiles } = await supabase
    .from('profiles')
    .select('id, nombre, telefono, porcentaje')
  if (errorPerfiles || !perfiles?.length) {
    return { ok: false, mensaje: 'No pude leer los perfiles de la libreta.' }
  }

  // --- 1. campos del gasto ---
  let monto: number | null
  let descripcion: string
  let categoria: string | null
  let esPersonal: boolean
  let esMitad = false
  let esAjuste = false
  let descuento: { pct: number; bruto: number } | null = null
  let tipo: 'gasto_depto' | 'gasto_fijo' = 'gasto_depto'
  let nombreEnTexto: string | null = null

  if (entrada.texto?.trim()) {
    const r = parsearGasto(entrada.texto, perfiles.map((p) => p.nombre))
    if (!r.ok) return { ok: false, mensaje: r.error }
    monto = r.gasto.monto // si hubo descuento ("30% tope 8000"), ya es el neto
    descripcion = r.gasto.descripcion
    categoria = r.gasto.categoria
    esPersonal = r.gasto.esPersonal
    esMitad = r.gasto.esMitad
    esAjuste = r.gasto.esAjuste
    descuento = r.gasto.descuento
    tipo = r.gasto.tipo
    nombreEnTexto = r.gasto.pagadorNombre
  } else {
    monto = parsearMonto(String(entrada.monto ?? '').trim())
    if (monto === null) {
      return { ok: false, mensaje: 'Monto inválido o vacío.' }
    }
    categoria = normalizarCategoria(entrada.categoria)
    descripcion = (entrada.descripcion ?? '').trim() || categoria || 'Gasto'
    descripcion = descripcion.charAt(0).toUpperCase() + descripcion.slice(1)
    esPersonal = Boolean(entrada.personal)
    if (categoria === 'servicios') tipo = 'gasto_fijo'
  }

  // --- 2. quién pagó: nombre en el texto > campo quien > teléfono remitente ---
  const porNombre = (n?: string | null) =>
    n ? perfiles.find((p) => sinAcentos(p.nombre) === sinAcentos(n)) ?? null : null

  let pagador = porNombre(nombreEnTexto) ?? porNombre(entrada.quienNombre)
  if (!pagador && entrada.telefono) {
    const tel = soloDigitos(entrada.telefono)
    pagador =
      perfiles.find((p) => p.telefono && soloDigitos(p.telefono) === tel) ?? null
  }
  if (!pagador) {
    return {
      ok: false,
      mensaje: entrada.telefono
        ? `Tu número (${entrada.telefono}) no está vinculado. Cargalo en profiles.telefono desde Supabase.`
        : 'No sé quién pagó: agregá el nombre (Mati o Vicky).',
    }
  }

  const fecha = entrada.fecha?.trim() || hoyArgentina()

  // Préstamo o devolución: plata directa entre los dos, directo al saldo
  if (esAjuste) {
    const { data: creado, error } = await supabase
      .from('movimientos')
      .insert({
        tipo: 'gasto_depto',
        fecha,
        descripcion,
        monto,
        pagado_por: pagador.id,
        categoria: null,
        prop_pagador: 0,
        es_prestamo: true,
      })
      .select('id')
      .single()
    if (error) return { ok: false, mensaje: `Error al guardar: ${error.message}` }
    if (creado) await avisarMovimiento(supabase, creado.id, pagador.id)
    return {
      ok: true,
      mensaje: `Anotado ✓ ${plata(monto)} — ${descripcion} (directo al saldo, puso ${pagador.nombre})`,
    }
  }

  // --- 3. reglas del catálogo de fijos (mitades, terceros como Seba) ---
  let fijoCatalogo: GastoFijoCatalogo | null = null
  if (!esPersonal) {
    const { data: fijosCat } = await supabase
      .from('gastos_fijos')
      .select('nombre, prop_pagador, paga_tercero, prop_tercero, tercero_deudor')
      .eq('activo', true)
    fijoCatalogo =
      (fijosCat as GastoFijoCatalogo[] | null)?.find((f) =>
        coincideNombre(descripcion, f.nombre)
      ) ?? null
    if (fijoCatalogo) tipo = 'gasto_fijo'
  }

  // Expensas y similares llevan el mes en la descripción (lo paga un
  // tercero: además del gasto del depto, queda una deuda con él)
  const descripcionFinal = fijoCatalogo?.paga_tercero
    ? `${descripcion} ${nombreMes(fecha.slice(0, 7))}`
    : descripcion

  // --- 4. insertar movimiento (y, si lo paga un tercero como Expensas →
  // Seba, la deuda vinculada con él: mismo patrón que usa la app, un solo
  // lugar que lo sabe hacer, ver lib/dividir.ts) ---
  // misma regla de división que la app (catálogo: 0.5 = mitades); sin regla
  // explícita se congela el % actual del perfil del pagador (no se deja en
  // null: así el movimiento queda auditable aunque el % cambie después)
  const propRegla = propPagador({ esPersonal, tipo, fijo: fijoCatalogo, mitad: esMitad })
  const prop = propRegla ?? Number(pagador.porcentaje)
  const categoriaFinal = categoria ?? (tipo === 'gasto_fijo' ? 'servicios' : 'otros')

  let mensajeDeuda = ''
  if (!esPersonal && fijoCatalogo?.paga_tercero) {
    const propTercero = Number(fijoCatalogo.prop_tercero ?? 0.5)
    const r = await crearGastoConTercero(
      supabase,
      {
        tipo,
        fecha,
        descripcion: descripcionFinal,
        monto,
        pagadorId: pagador.id,
        categoria: categoriaFinal,
        propPagador: prop,
      },
      {
        nombre: fijoCatalogo.paga_tercero,
        prop: propTercero,
        deudorId: fijoCatalogo.tercero_deudor ?? pagador.id,
      }
    )
    if (!r.ok) return { ok: false, mensaje: `Error al guardar: ${r.error}` }
    await avisarMovimiento(supabase, r.movimientoId, pagador.id)
    await avisarDeuda(supabase, r.deudaId, pagador.id)
    const deudorNombre =
      perfiles.find((p) => p.id === (fijoCatalogo.tercero_deudor ?? pagador.id))?.nombre ??
      pagador.nombre
    mensajeDeuda = ` y ${plata(parteDelTercero(monto, propTercero))} quedó como deuda de ${deudorNombre} con ${fijoCatalogo.paga_tercero}`
  } else {
    const { data: creado, error } = await supabase
      .from('movimientos')
      .insert({
        tipo: esPersonal ? 'gasto_depto' : tipo,
        fecha,
        descripcion: descripcionFinal,
        monto,
        pagado_por: pagador.id,
        // las categorías son obligatorias: sin pista, va a "otros"
        categoria: categoriaFinal,
        // es_personal va solo cuando hace falta: lo compartido funciona
        // aunque la migración v2 todavía no se haya corrido
        ...(esPersonal ? { prop_pagador: 1, es_personal: true } : { prop_pagador: prop }),
      })
      .select('id')
      .single()
    if (error) return { ok: false, mensaje: `Error al guardar: ${error.message}` }
    if (!esPersonal) await avisarMovimiento(supabase, creado.id, pagador.id)
  }

  const division = esPersonal
    ? 'personal'
    : prop === 0.5
      ? 'mitad y mitad'
      : prop == null
        ? 'compartido'
        : `${Math.round(prop * 100)}% del pagador`
  const promo = descuento ? `, ${descuento.pct}% off de ${plata(descuento.bruto)}` : ''
  return {
    ok: true,
    mensaje: `Anotado ✓ ${plata(monto)} — ${descripcionFinal} (${division}, pagó ${pagador.nombre}${promo})${mensajeDeuda}`,
  }
}

type GastoFijoCatalogo = {
  nombre: string
  prop_pagador: number | null
  paga_tercero: string | null
  prop_tercero: number | null
  tercero_deudor: string | null
}
