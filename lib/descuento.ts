/**
 * Descuentos de promos (banco/billetera): "30% off con tope de $8.000
 * de reintegro". El descuento es pct% del bruto, recortado al tope si
 * hay. La app guarda siempre el monto NETO: es lo que de verdad costó.
 */
export function montoDescuento(
  bruto: number,
  pct: number,
  tope?: number | null
): number {
  const d = bruto * (pct / 100)
  const recortado = tope != null && tope >= 0 ? Math.min(d, tope) : d
  return Math.round(recortado * 100) / 100
}

export function netoConDescuento(
  bruto: number,
  pct: number,
  tope?: number | null
): number {
  return Math.round((bruto - montoDescuento(bruto, pct, tope)) * 100) / 100
}
