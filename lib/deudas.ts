import type { Deuda, Profile } from './types'

/**
 * Agrupación y filtrado de `deudas` para /deudas y /resumen.
 *
 * Desde la migración v3, tanto el acreedor como el deudor pueden ser
 * 'interno' (Mati o Vicky) o 'externo' (un tercero, por nombre). Sin esa
 * migración, `deudor_tipo`/`deudor_nombre` no existen: se asume 'interno'
 * (como era antes).
 */

export const nombreDePerfil = (perfiles: Profile[], id: string | null | undefined) =>
  perfiles.find((p) => p.id === id)?.nombre ?? '—'

/** A quién se le debe: un tercero por nombre, o el perfil interno. */
export function etiquetaAcreedor(d: Deuda, perfiles: Profile[]) {
  return d.acreedor_tipo === 'interno'
    ? nombreDePerfil(perfiles, d.acreedor_profile)
    : d.acreedor_nombre ?? '—'
}

/** Quién debe: un tercero por nombre, o el perfil interno. */
export function etiquetaDeudor(d: Deuda, perfiles: Profile[]) {
  return (d.deudor_tipo ?? 'interno') === 'interno'
    ? nombreDePerfil(perfiles, d.deudor)
    : d.deudor_nombre ?? '—'
}

export type GrupoDeuda = {
  nombre: string
  deudas: Deuda[]
  cuotaMensual: number
  restante: number
}

/** Agrupa deudas por `etiqueta(d)`, con el total de cuota mensual y lo
 * que falta (solo de las activas) de cada grupo. */
export function agruparDeudas(deudas: Deuda[], etiqueta: (d: Deuda) => string): GrupoDeuda[] {
  const grupos = new Map<string, Deuda[]>()
  for (const d of deudas) {
    const clave = etiqueta(d)
    grupos.set(clave, [...(grupos.get(clave) ?? []), d])
  }
  return [...grupos.entries()].map(([nombre, lista]) => {
    const activas = lista.filter((d) => d.activa)
    return {
      nombre,
      deudas: lista,
      cuotaMensual: activas.reduce((a, d) => a + Number(d.valor_cuota), 0),
      restante: activas.reduce((a, d) => a + Number(d.valor_cuota) * d.cuotas_restantes, 0),
    }
  })
}

/** Lo que debés vos: deudas donde sos el deudor interno (a un tercero o
 * al otro miembro de la pareja). */
export function deudasQueDebes(deudas: Deuda[], userId: string | null) {
  return deudas.filter(
    (d) => (d.deudor_tipo ?? 'interno') === 'interno' && d.deudor === userId
  )
}

/** Lo que te deben a vos: deudas donde sos el acreedor interno (te debe
 * el otro miembro de la pareja, o un tercero). */
export function deudasQueTeDeben(deudas: Deuda[], userId: string | null) {
  return deudas.filter((d) => d.acreedor_tipo === 'interno' && d.acreedor_profile === userId)
}
