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
  created_at: string
}

export type Deuda = {
  id: string
  descripcion: string
  acreedor_tipo: 'externo' | 'interno'
  acreedor_nombre: string | null
  acreedor_profile: string | null
  deudor: string
  monto_total: number
  cantidad_cuotas: number
  cuota_actual: number
  valor_cuota: number
  cuotas_restantes: number
  fecha_primera_cuota: string | null
  activa: boolean
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
  /** Si lo paga un tercero (ej: 'Seba'): al cargarlo no se crea un movimiento
   * sino una deuda con ese tercero por la parte de quien carga. */
  paga_tercero?: string | null
  /** Parte que se le debe al tercero (null = la mitad). */
  prop_tercero?: number | null
}

/** Mes 'tachado': la división de ese mes ya se transfirió. */
export type MesSaldado = {
  mes: string // 'YYYY-MM'
  monto: number | null
  saldado_por: string | null
  created_at: string
}

export const CATEGORIAS = [
  'súper',
  'salidas',
  'transporte',
  'delivery',
  'regalos',
  'servicios',
  'hogar',
  'otros',
] as const
