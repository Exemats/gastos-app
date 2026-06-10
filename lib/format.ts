const fmt = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  maximumFractionDigits: 0,
})

const fmtDec = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export function plata(n: number) {
  return fmt.format(n)
}

export function plataExacta(n: number) {
  return fmtDec.format(n)
}

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

export function nombreMes(yyyyMm: string) {
  const [y, m] = yyyyMm.split('-').map(Number)
  return `${MESES[m - 1]} ${y}`
}

export function nombreMesCorto(yyyyMm: string) {
  const m = Number(yyyyMm.split('-')[1])
  return MESES[m - 1].slice(0, 3)
}

const fmtCompacto = new Intl.NumberFormat('es-AR', {
  notation: 'compact',
  maximumFractionDigits: 1,
})

/** "$1,2 M" / "$45 mil" — para etiquetas de gráficos. */
export function plataCompacta(n: number) {
  return `$${fmtCompacto.format(n)}`
}

export function fechaCorta(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${String(y).slice(2)}`
}

export function hoyISO() {
  const d = new Date()
  const off = d.getTimezoneOffset()
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10)
}

/** Fecha de hoy en Argentina (el servidor corre en UTC). en-CA da YYYY-MM-DD. */
export function hoyArgentina() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
  }).format(new Date())
}

/** Suma/resta meses a un 'YYYY-MM'. */
export function mesShift(yyyyMm: string, delta: number) {
  const [y, m] = yyyyMm.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/**
 * Balance neto entre los dos perfiles a partir de los movimientos.
 * Misma lógica que balance_view, calculada acá para mostrarla relativa
 * al usuario logueado sin depender de nombres hardcodeados.
 *
 * puso_de_mas = monto - monto * prop  (lo que pagó de la parte del otro)
 * balance > 0 respecto de A => el otro le debe a A.
 */
export function calcularBalance(
  movimientos: { monto: number; pagado_por: string; prop_pagador: number | null }[],
  perfiles: { id: string; porcentaje: number }[]
) {
  const porId = new Map(perfiles.map((p) => [p.id, p]))
  const pusoDeMas = new Map<string, number>(perfiles.map((p) => [p.id, 0]))

  for (const m of movimientos) {
    const perfil = porId.get(m.pagado_por)
    if (!perfil) continue
    const prop = m.prop_pagador ?? perfil.porcentaje
    const extra = Number(m.monto) - Number(m.monto) * Number(prop)
    pusoDeMas.set(m.pagado_por, (pusoDeMas.get(m.pagado_por) ?? 0) + extra)
  }

  return pusoDeMas
}
