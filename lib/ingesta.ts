import { createAdminClient } from './supabase/admin'
import { parsearGasto, parsearMonto, normalizarCategoria, sinAcentos } from './parsear-gasto'
import { hoyArgentina, plata } from './format'

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
    .select('id, nombre, telefono')
  if (errorPerfiles || !perfiles?.length) {
    return { ok: false, mensaje: 'No pude leer los perfiles de la libreta.' }
  }

  // --- 1. campos del gasto ---
  let monto: number | null
  let descripcion: string
  let categoria: string | null
  let esPersonal: boolean
  let tipo: 'gasto_depto' | 'gasto_fijo' = 'gasto_depto'
  let nombreEnTexto: string | null = null

  if (entrada.texto?.trim()) {
    const r = parsearGasto(entrada.texto, perfiles.map((p) => p.nombre))
    if (!r.ok) return { ok: false, mensaje: r.error }
    monto = r.gasto.monto
    descripcion = r.gasto.descripcion
    categoria = r.gasto.categoria
    esPersonal = r.gasto.esPersonal
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

  // --- 3. insertar ---
  const fecha = entrada.fecha?.trim() || hoyArgentina()
  const { error } = await supabase.from('movimientos').insert({
    tipo: esPersonal ? 'gasto_depto' : tipo,
    fecha,
    descripcion,
    monto,
    pagado_por: pagador.id,
    categoria,
    // es_personal va solo cuando hace falta: lo compartido funciona
    // aunque la migración v2 todavía no se haya corrido
    ...(esPersonal ? { prop_pagador: 1, es_personal: true } : { prop_pagador: null }),
  })
  if (error) return { ok: false, mensaje: `Error al guardar: ${error.message}` }

  return {
    ok: true,
    mensaje: `Anotado ✓ ${plata(monto)} — ${descripcion} (${
      esPersonal ? 'personal' : 'compartido'
    }, pagó ${pagador.nombre})`,
  }
}
