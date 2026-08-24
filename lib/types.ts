export type Profile = {
  id: string
  nombre: string
  porcentaje: number
  telefono?: string | null
}

export type Movimiento = {
  id: string
  tipo: 'gasto_depto' | 'gasto_fijo'
  fecha: string
  descripcion: string
  monto: number
  pagado_por: string
  prop_pagador: number | null
  categoria: string | null
  es_personal: boolean
  /** Plata directa entre ustedes (préstamo/devolución): 100% a favor de
   * quien la puso, no es un gasto. Reemplaza la vieja categoria='ajuste'. */
  es_prestamo: boolean
  created_at: string
}

export type Deuda = {
  id: string
  descripcion: string
  acreedor_tipo: 'externo' | 'interno'
  acreedor_nombre: string | null
  acreedor_profile: string | null
  /** 'interno' = debe Mati o Vicky (deudor = su uuid); 'externo' = debe un
   * tercero (deudor_nombre). Si falta (sin migración v3), tratar como 'interno'. */
  deudor_tipo?: 'externo' | 'interno'
  deudor: string | null
  /** Si deudor_tipo = 'externo': nombre de quien te debe. */
  deudor_nombre?: string | null
  monto_total: number
  cantidad_cuotas: number
  cuota_actual: number
  valor_cuota: number
  cuotas_restantes: number
  fecha_primera_cuota: string | null
  activa: boolean
  /** Si esta deuda nació junto con un gasto del depto (ej: Expensas →
   * Seba), el movimiento que la generó (migración v4). */
  movimiento_id?: string | null
  /** Si esta deuda se cargó "dividida" con la otra persona, el id de su
   * par — la otra mitad (migración v4). Se editan/borran por separado. */
  vinculo_id?: string | null
  created_at?: string
}

export type GastoFijo = {
  id: string
  nombre: string
  monto_estimado: number | null
  dia_vencimiento: number | null
  activo: boolean
  /** Cómo se divide: 0.5 = mitad y mitad; null = porcentaje del perfil. */
  prop_pagador?: number | null
  /** Si lo paga un tercero (ej: 'Seba'): al cargarlo se anota igual el
   * movimiento (gasto del depto) y además una deuda con ese tercero por
   * la parte de quien queda debiéndole (tercero_deudor). */
  paga_tercero?: string | null
  /** Parte que se le debe al tercero (null = la mitad). */
  prop_tercero?: number | null
  /** Quién le queda debiendo esa parte al tercero, sin importar quién
   * cargue el gasto. null = quien carga. */
  tercero_deudor?: string | null
}

/** Mes 'tachado': la división de ese mes ya se transfirió. */
export type MesSaldado = {
  mes: string // 'YYYY-MM'
  monto: number | null
  saldado_por: string | null
  created_at: string
}

/** Límite mensual (opcional) por categoría de lo compartido. */
export type Presupuesto = {
  categoria: string
  monto: number
}

/**
 * Categorías de gasto: amplias, claras y ordenadas por uso (la más
 * frecuente primero, "otros" como comodín al final). Son obligatorias:
 * la app las sugiere sola desde la descripción. 'servicios' despliega
 * las subcategorías del catálogo gastos_fijos (luz, gas, expensas…).
 */
export const CATEGORIAS = [
  'súper',
  'delivery',
  'salidas',
  'transporte',
  'servicios',
  'hogar',
  'salud',
  'regalos',
  'otros',
] as const
