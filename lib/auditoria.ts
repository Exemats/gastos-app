import type { Deuda, Movimiento, Profile } from './types'

/**
 * El desglose auditable del mes: la única fuente de verdad de cómo se
 * llega al "Fulano le debe $X a Mengano". La usan tanto la pantalla de
 * Resumen (para mostrarlo línea por línea) como "copiar resumen del mes"
 * (para que lo que se copia sea exactamente lo que se ve).
 *
 * Tres fuentes se suman al neto del mes:
 *   1. Gastos compartidos (depto y fijos): cada uno según su %.
 *   2. Ajustes (préstamos/devoluciones entre ustedes): 100% a favor de
 *      quien puso la plata.
 *   3. Cuotas internas vigentes (lo que se deben entre ustedes en
 *      cuotas): solo se suman al mes EN CURSO, porque no están atadas a
 *      una fecha del mes sino a "cuánto toca pagar ahora". Esto se marca
 *      explícito en `incluyeCuotas` para no esconder la razón por la que
 *      un mes pasado no las incluye.
 */

/** De dónde sale el % aplicado a un gasto: para no mostrar "37%" sin
 * explicar si es la regla de siempre, una mitad, o algo puntual. */
export type OrigenProp =
  | { tipo: 'partes' } // el % de siempre del pagador (profiles.porcentaje)
  | { tipo: 'mitad' } // 50/50
  | { tipo: 'pagador' } // 100% de quien pagó (no genera deuda)
  | { tipo: 'custom' } // otro % puntual, elegido a mano

export function origenProp(
  m: { prop_pagador: number | null; pagado_por: string },
  perfiles: Pick<Profile, 'id' | 'porcentaje'>[]
): OrigenProp {
  const propPerfil = perfiles.find((p) => p.id === m.pagado_por)?.porcentaje
  // null = fila vieja, de antes de guardar el % ya resuelto: se sigue
  // leyendo como "sus partes" contra el % actual del perfil
  if (m.prop_pagador == null) return { tipo: 'partes' }
  const prop = Number(m.prop_pagador)
  if (propPerfil != null && prop === Number(propPerfil)) return { tipo: 'partes' }
  if (prop === 0.5) return { tipo: 'mitad' }
  if (prop === 1) return { tipo: 'pagador' }
  return { tipo: 'custom' }
}

export function etiquetaOrigenProp(o: OrigenProp, prop: number): string {
  switch (o.tipo) {
    case 'partes':
      return `sus partes de siempre (${Math.round(prop * 100)}%)`
    case 'mitad':
      return '50/50'
    case 'pagador':
      return '100% de quien pagó'
    case 'custom':
      return `${Math.round(prop * 100)}% puntual`
  }
}

export type LineaGasto = {
  mov: Movimiento
  pagador: Profile
  otro: Profile
  /** Proporción del gasto que le corresponde al pagador. */
  prop: number
  origen: OrigenProp
  /** Lo que le corresponde pagar a cada uno de este gasto. */
  partePagador: number
  parteOtro: number
  /** Lo que "otro" le queda debiendo a "pagador" por este gasto (puede
   * ser 0 o, si el pagador puso de menos, negativo). */
  quedaDebiendoOtro: number
}

function lineaGasto(m: Movimiento, p1: Profile, p2: Profile): LineaGasto {
  const perfiles = [p1, p2]
  const pagador = m.pagado_por === p1.id ? p1 : p2
  const otro = pagador.id === p1.id ? p2 : p1
  const origen = origenProp(m, perfiles)
  const prop = Number(m.prop_pagador ?? pagador.porcentaje)
  const monto = Number(m.monto)
  const partePagador = Math.round(monto * prop * 100) / 100
  const parteOtro = Math.round((monto - partePagador) * 100) / 100
  return { mov: m, pagador, otro, prop, origen, partePagador, parteOtro, quedaDebiendoOtro: parteOtro }
}

export type LineaAjuste = {
  mov: Movimiento
  /** Quien puso la plata: queda a su favor, entero. */
  pagador: Profile
  monto: number
}

export type LineaCuota = {
  deuda: Deuda
  /** A quién se le debe esta cuota (el otro miembro de la pareja). */
  acreedor: Profile
  valorCuota: number
}

export type PorPersonaGasto = {
  perfil: Profile
  /** Cuánto puso en total de gastos compartidos este mes. */
  pago: number
  /** Cuánto le tocaba pagar según su %, en cada gasto. */
  suParte: number
  /** pago - suParte: positivo = puso de más (a su favor). */
  neto: number
}

/** Una línea cualquiera del desglose, etiquetada por de dónde sale. */
export type LineaCategoria =
  | ({ tipo: 'gasto' } & LineaGasto)
  | ({ tipo: 'ajuste' } & LineaAjuste)
  | ({ tipo: 'cuota' } & LineaCuota)

export type GrupoCategoria = {
  /** El nombre de la categoría ('súper', 'servicios'…) o de la fuente
   * especial ('Plata entre ustedes', 'Cuotas entre ustedes'). */
  categoria: string
  lineas: LineaCategoria[]
  total: number
  /** p1 a favor menos p2 a favor, de este grupo (con signo). */
  diff: number
  /** false solo para "Cuotas entre ustedes" en un mes que no es el
   * actual: las cuotas se muestran igual, pero no suman al neto. */
  incluidoEnTotal: boolean
}

function montoDeLinea(l: LineaCategoria): number {
  if (l.tipo === 'gasto') return Number(l.mov.monto)
  if (l.tipo === 'ajuste') return l.monto
  return l.valorCuota
}

function diffDeLinea(l: LineaCategoria, p1Id: string): number {
  const signo = (id: string) => (id === p1Id ? 1 : -1)
  if (l.tipo === 'gasto') return signo(l.pagador.id) * l.quedaDebiendoOtro
  if (l.tipo === 'ajuste') return signo(l.pagador.id) * l.monto
  return signo(l.acreedor.id) * l.valorCuota
}

/**
 * Agrupa TODAS las líneas del mes (gastos, préstamos, cuotas internas)
 * por categoría, para poder desplegar "por qué súper dio $X" o "por qué
 * servicios dio $Y" en vez de solo tres fuentes grandes. Los préstamos y
 * las cuotas internas son sus propias "categorías" especiales.
 */
function agruparPorCategoria(
  gastos: LineaGasto[],
  ajustes: LineaAjuste[],
  cuotas: LineaCuota[],
  incluyeCuotas: boolean,
  p1Id: string
): GrupoCategoria[] {
  const armar = (categoria: string, lineas: LineaCategoria[], incluidoEnTotal = true): GrupoCategoria => ({
    categoria,
    lineas,
    total: lineas.reduce((a, l) => a + montoDeLinea(l), 0),
    diff: lineas.reduce((a, l) => a + diffDeLinea(l, p1Id), 0),
    incluidoEnTotal,
  })

  const porCategoria = new Map<string, LineaCategoria[]>()
  for (const g of gastos) {
    const cat = g.mov.categoria ?? (g.mov.tipo === 'gasto_fijo' ? 'servicios' : 'sin categoría')
    porCategoria.set(cat, [...(porCategoria.get(cat) ?? []), { tipo: 'gasto', ...g }])
  }
  const grupos = [...porCategoria.entries()]
    .map(([categoria, lineas]) => armar(categoria, lineas))
    .sort((a, b) => b.total - a.total)

  if (ajustes.length > 0) {
    grupos.push(armar('Plata entre ustedes', ajustes.map((a) => ({ tipo: 'ajuste', ...a }))))
  }
  if (cuotas.length > 0) {
    grupos.push(
      armar('Cuotas entre ustedes', cuotas.map((c) => ({ tipo: 'cuota', ...c })), incluyeCuotas)
    )
  }
  return grupos
}

export type Auditoria = {
  p1: Profile
  p2: Profile
  gastos: LineaGasto[]
  ajustes: LineaAjuste[]
  cuotas: LineaCuota[]
  /** Todo lo de arriba, agrupado por categoría — para desplegar el
   * desglose de a una categoría por vez. */
  gruposPorCategoria: GrupoCategoria[]
  porPersonaGastos: PorPersonaGasto[]
  totalGastos: number
  totalAjustes: number
  totalCuotas: number
  /** p1 a favor menos p2 a favor, de cada fuente (con signo). */
  diffGastos: number
  diffAjustes: number
  diffCuotas: number
  /** true si `cuotas`/`diffCuotas` entran en `diffTotal` (solo el mes en
   * curso: las cuotas internas no están atadas a un mes pasado). */
  incluyeCuotas: boolean
  diffTotal: number
  deudor: Profile
  acreedor: Profile
  monto: number
}

/**
 * Arma el desglose completo de un mes a partir de sus movimientos ya
 * filtrados (gastos compartidos sin personales/ajustes, los ajustes del
 * mes, y las deudas "internas" activas). `incluyeCuotas` decide si las
 * cuotas internas suman al neto de este mes (solo el mes en curso).
 */
export function calcularAuditoria(
  gastosMes: Movimiento[],
  ajustesMes: Movimiento[],
  cuotasInternasActivas: Deuda[],
  p1: Profile,
  p2: Profile,
  incluyeCuotas: boolean
): Auditoria {
  const gastos = gastosMes.map((m) => lineaGasto(m, p1, p2))
  const ajustes: LineaAjuste[] = ajustesMes.map((m) => ({
    mov: m,
    pagador: m.pagado_por === p1.id ? p1 : p2,
    monto: Number(m.monto),
  }))
  const cuotas: LineaCuota[] = cuotasInternasActivas.flatMap((d) => {
    const acreedor = d.acreedor_profile === p1.id ? p1 : d.acreedor_profile === p2.id ? p2 : null
    return acreedor ? [{ deuda: d, acreedor, valorCuota: Number(d.valor_cuota) }] : []
  })

  const porPersonaGastos: PorPersonaGasto[] = [p1, p2].map((perfil) => {
    let pago = 0
    let suParte = 0
    for (const g of gastos) {
      if (g.pagador.id === perfil.id) {
        pago += Number(g.mov.monto)
        suParte += g.partePagador
      } else {
        suParte += g.parteOtro
      }
    }
    return { perfil, pago, suParte, neto: pago - suParte }
  })

  const signoP1 = (id: string) => (id === p1.id ? 1 : -1)
  const diffGastos = gastos.reduce((a, g) => a + signoP1(g.pagador.id) * g.quedaDebiendoOtro, 0)
  const diffAjustes = ajustes.reduce((a, l) => a + signoP1(l.pagador.id) * l.monto, 0)
  const diffCuotas = cuotas.reduce((a, l) => a + signoP1(l.acreedor.id) * l.valorCuota, 0)
  const diffTotal = diffGastos + diffAjustes + (incluyeCuotas ? diffCuotas : 0)
  const gruposPorCategoria = agruparPorCategoria(gastos, ajustes, cuotas, incluyeCuotas, p1.id)

  return {
    p1,
    p2,
    gastos,
    ajustes,
    cuotas,
    gruposPorCategoria,
    porPersonaGastos,
    totalGastos: gastosMes.reduce((a, m) => a + Number(m.monto), 0),
    totalAjustes: ajustesMes.reduce((a, m) => a + Number(m.monto), 0),
    totalCuotas: cuotas.reduce((a, l) => a + l.valorCuota, 0),
    diffGastos,
    diffAjustes,
    diffCuotas,
    incluyeCuotas,
    diffTotal,
    deudor: diffTotal > 0 ? p2 : p1,
    acreedor: diffTotal > 0 ? p1 : p2,
    monto: Math.abs(diffTotal),
  }
}
