import type { Deuda, GastoFijo, Movimiento } from './types'
import { coincideNombre } from './parsear-gasto'

/**
 * Servicios del catálogo (activos) que todavía no tienen nada cargado en
 * el mes dado: un movimiento (o, si los paga un tercero, una deuda). Lo
 * usan el dashboard (recordatorio del mes en curso) y el cierre de
 * Resumen (para no tachar un mes al que le falta cargar algo) — un solo
 * lugar que sabe responder "¿está todo cargado?".
 */
export function serviciosFaltantes(
  mes: string,
  movimientosDelMes: Pick<Movimiento, 'descripcion'>[],
  deudas: Pick<Deuda, 'descripcion' | 'created_at' | 'fecha_primera_cuota'>[],
  fijosActivos: GastoFijo[]
): GastoFijo[] {
  return fijosActivos.filter((f) => {
    if (f.paga_tercero) {
      // Expensas y similares: además del movimiento, siempre se crea la
      // deuda con el tercero — alcanza con mirar esa
      return !deudas.some(
        (d) =>
          coincideNombre(d.descripcion, f.nombre) &&
          (d.created_at?.startsWith(mes) || d.fecha_primera_cuota?.startsWith(mes))
      )
    }
    return !movimientosDelMes.some((m) => coincideNombre(m.descripcion, f.nombre))
  })
}
