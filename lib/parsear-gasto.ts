import { CATEGORIAS } from './types'

/**
 * Parser de texto libre para cargar gastos desde WhatsApp, atajos del celu
 * o lo que se comparta a la app. Ejemplos que entiende:
 *   "12500 súper"            -> $12.500, categoría súper, compartido
 *   "luz 45.000"             -> $45.000, gasto fijo, categoría servicios
 *   "personal 8000 gym"      -> $8.000, personal (no se divide)
 *   "vicky 9000 farmacia"    -> $9.000, pagó Vicky
 *   "1.234,56 ferretería"    -> $1.234,56
 */
export type GastoParseado = {
  monto: number
  descripcion: string
  categoria: string | null
  esPersonal: boolean
  tipo: 'gasto_depto' | 'gasto_fijo'
  pagadorNombre: string | null
}

export type ResultadoParseo =
  | { ok: true; gasto: GastoParseado }
  | { ok: false; error: string }

export const sinAcentos = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

const PERSONAL_PALABRAS = new Set(['personal', 'mio', 'mia', 'propio', 'privado'])
const FIJO_PALABRAS = new Set(['fijo', 'servicio'])

// sinónimo (escrito sin acentos) -> categoría canónica de CATEGORIAS
const SINONIMOS: Record<string, (typeof CATEGORIAS)[number]> = {
  super: 'súper',
  supermercado: 'súper',
  chino: 'súper',
  verduleria: 'súper',
  carniceria: 'súper',
  salida: 'salidas',
  salidas: 'salidas',
  bar: 'salidas',
  resto: 'salidas',
  restaurante: 'salidas',
  cine: 'salidas',
  transporte: 'transporte',
  uber: 'transporte',
  didi: 'transporte',
  taxi: 'transporte',
  sube: 'transporte',
  nafta: 'transporte',
  delivery: 'delivery',
  pedidosya: 'delivery',
  rappi: 'delivery',
  regalo: 'regalos',
  regalos: 'regalos',
  servicios: 'servicios',
  luz: 'servicios',
  gas: 'servicios',
  internet: 'servicios',
  wifi: 'servicios',
  agua: 'servicios',
  expensas: 'servicios',
  abl: 'servicios',
  hogar: 'hogar',
  casa: 'hogar',
  ferreteria: 'hogar',
  otros: 'otros',
}

// servicios típicos: además de la categoría, marcan el movimiento como fijo
const FIJOS_TIPICOS = new Set(['luz', 'gas', 'internet', 'wifi', 'agua', 'expensas', 'abl'])

/** "12.500" / "12500,50" / "$1.234,56" -> número, o null si no es un monto. */
export function parsearMonto(token: string): number | null {
  let t = token.replace(/^\$/, '').replace(/[.,]$/, '')
  if (!/^\d[\d.,]*$/.test(t)) return null
  const tienePunto = t.includes('.')
  const tieneComa = t.includes(',')
  if (tienePunto && tieneComa) {
    // el separador que aparece último es el decimal
    if (t.lastIndexOf('.') > t.lastIndexOf(',')) t = t.replace(/,/g, '')
    else t = t.replace(/\./g, '').replace(',', '.')
  } else if (tieneComa) {
    t = t.replace(/,/g, '.') // uso argentino: coma decimal
  } else if (tienePunto) {
    // "12.500" es miles, "12.5" es decimal
    const partes = t.split('.')
    if (partes[partes.length - 1].length === 3) t = partes.join('')
  }
  const n = Number(t)
  return Number.isFinite(n) && n > 0 ? n : null
}

/** Lleva una categoría escrita a mano a la canónica ('Súper' -> 'súper'). */
export function normalizarCategoria(cat?: string | null): string | null {
  if (!cat?.trim()) return null
  const norm = sinAcentos(cat.trim())
  if (SINONIMOS[norm]) return SINONIMOS[norm]
  const directa = CATEGORIAS.find((c) => sinAcentos(c) === norm)
  return directa ?? cat.trim().toLowerCase()
}

/**
 * ¿La descripción corresponde a este fijo del catálogo? Coincide la palabra
 * completa ("Expensas junio" ↔ "Expensas") pero no un prefijo suelto
 * ("Gaseosas" NO es el fijo "Gas").
 */
export function coincideNombre(descripcion: string, nombre: string) {
  const d = sinAcentos(descripcion.trim())
  const n = sinAcentos(nombre.trim())
  return d === n || d.startsWith(n + ' ')
}

export function parsearGasto(
  texto: string,
  nombresPerfiles: string[] = []
): ResultadoParseo {
  const palabras = texto.trim().split(/\s+/).filter(Boolean)
  if (palabras.length === 0) {
    return { ok: false, error: 'Mandá algo como: "12500 súper" o "personal 8000 gym".' }
  }

  const nombresNorm = new Map(nombresPerfiles.map((n) => [sinAcentos(n), n]))

  let monto: number | null = null
  let esPersonal = false
  let tipo: 'gasto_depto' | 'gasto_fijo' = 'gasto_depto'
  let categoria: string | null = null
  let pagadorNombre: string | null = null
  const restantes: string[] = []

  for (const palabra of palabras) {
    const limpia = palabra.replace(/[¿?¡!:;()"]/g, '')
    const norm = sinAcentos(limpia)
    if (monto === null) {
      const m = parsearMonto(limpia)
      if (m !== null) {
        monto = m
        continue
      }
    }
    if (PERSONAL_PALABRAS.has(norm)) {
      esPersonal = true
      continue
    }
    if (FIJO_PALABRAS.has(norm)) {
      tipo = 'gasto_fijo'
      continue
    }
    if (nombresNorm.has(norm)) {
      pagadorNombre = nombresNorm.get(norm)!
      continue
    }
    if (!categoria && SINONIMOS[norm]) {
      categoria = SINONIMOS[norm]
      if (FIJOS_TIPICOS.has(norm)) tipo = 'gasto_fijo'
      restantes.push(limpia) // la palabra de categoría también describe el gasto
      continue
    }
    restantes.push(limpia)
  }

  if (monto === null) {
    return {
      ok: false,
      error: 'No encontré el monto. Ejemplo: "12500 súper" o "luz 45000".',
    }
  }

  let descripcion = restantes.join(' ').trim()
  if (!descripcion) descripcion = categoria ?? 'Gasto'
  descripcion = descripcion.charAt(0).toUpperCase() + descripcion.slice(1)

  return {
    ok: true,
    gasto: { monto, descripcion, categoria, esPersonal, tipo, pagadorNombre },
  }
}
