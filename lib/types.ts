export type Profile = {
  id: string
  nombre: string
  porcentaje: number
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
}

export type GastoFijo = {
  id: string
  nombre: string
  monto_estimado: number | null
  dia_vencimiento: number | null
  activo: boolean
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
