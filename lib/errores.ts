/**
 * Traduce errores crípticos de la base a una instrucción accionable.
 * El caso típico: la app nueva deployada sin haber corrido la migración.
 */
export function errorLegible(mensaje: string) {
  if (/es_personal|meses_saldados|schema cache/i.test(mensaje)) {
    return 'Falta correr la migración en Supabase: SQL Editor → pegar docs/migracion_v2.sql → Run.'
  }
  return mensaje
}
