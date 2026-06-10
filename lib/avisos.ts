import type { SupabaseClient } from '@supabase/supabase-js'
import { enviarPush } from './push'
import { calcularBalance, plata, nombreMes, hoyArgentina, mesShift } from './format'
import { coincideNombre } from './parsear-gasto'

/**
 * Qué se avisa y a quién. Server-only (usa el cliente admin).
 * Todo es best-effort: jamás rompe la operación que lo dispara.
 */

type PerfilMin = { id: string; nombre: string; porcentaje: number }

async function perfilesDe(admin: SupabaseClient): Promise<PerfilMin[]> {
  const { data } = await admin.from('profiles').select('id, nombre, porcentaje')
  return (data ?? []).map((p) => ({ ...p, porcentaje: Number(p.porcentaje) }))
}

const nombreDe = (perfiles: PerfilMin[], id: string | null) =>
  perfiles.find((p) => p.id === id)?.nombre ?? 'Alguien'

/** Gasto nuevo: avisa al otro; y a los dos si una categoría cruzó su límite. */
export async function avisarMovimiento(
  admin: SupabaseClient,
  movimientoId: string,
  actorId: string
) {
  try {
    const [{ data: mov }, perfiles] = await Promise.all([
      admin.from('movimientos').select('*').eq('id', movimientoId).single(),
      perfilesDe(admin),
    ])
    if (!mov || mov.es_personal) return // lo personal no se anuncia

    const otros = perfiles.filter((p) => p.id !== actorId).map((p) => p.id)
    await enviarPush(admin, otros, {
      titulo: `${nombreDe(perfiles, actorId)} anotó un gasto`,
      cuerpo: `${mov.descripcion} — ${plata(Number(mov.monto))}`,
      url: '/resumen',
      tag: 'gasto-nuevo',
    })

    // ¿este gasto hizo cruzar el límite de su categoría?
    const categoria = mov.categoria
    if (!categoria || categoria === 'ajuste') return
    const { data: pres } = await admin
      .from('presupuestos')
      .select('monto')
      .eq('categoria', categoria)
      .maybeSingle()
    if (!pres) return
    const limite = Number(pres.monto)
    const mes = String(mov.fecha).slice(0, 7)
    const { data: delMes } = await admin
      .from('movimientos')
      .select('monto, categoria, fecha, es_personal')
      .eq('categoria', categoria)
      .gte('fecha', `${mes}-01`)
      .lte('fecha', `${mes}-31`)
    const total = (delMes ?? [])
      .filter((m) => !m.es_personal)
      .reduce((a, m) => a + Number(m.monto), 0)
    if (total > limite && total - Number(mov.monto) <= limite) {
      await enviarPush(admin, null, {
        titulo: `⚠ ${categoria} pasó el límite`,
        cuerpo: `Van ${plata(total)} de ${plata(limite)} este mes.`,
        url: '/resumen',
        tag: `limite-${categoria}`,
      })
    }
  } catch {
    // los avisos nunca rompen la carga
  }
}

/** Deuda nueva (cuotas o Expensas → Seba): avisa al otro. */
export async function avisarDeuda(admin: SupabaseClient, deudaId: string, actorId: string) {
  try {
    const [{ data: deuda }, perfiles] = await Promise.all([
      admin.from('deudas').select('*').eq('id', deudaId).single(),
      perfilesDe(admin),
    ])
    if (!deuda) return
    const acreedor =
      deuda.acreedor_tipo === 'interno'
        ? nombreDe(perfiles, deuda.acreedor_profile)
        : deuda.acreedor_nombre
    const otros = perfiles.filter((p) => p.id !== actorId).map((p) => p.id)
    await enviarPush(admin, otros, {
      titulo: `${nombreDe(perfiles, actorId)} anotó una deuda`,
      cuerpo: `${deuda.descripcion} → ${acreedor} (${plata(Number(deuda.monto_total))})`,
      url: '/deudas',
      tag: 'deuda-nueva',
    })
  } catch {
    /* best-effort */
  }
}

/** Mes tachado: avisa al otro que ya quedó saldado. */
export async function avisarTachado(admin: SupabaseClient, mes: string, actorId: string) {
  try {
    const perfiles = await perfilesDe(admin)
    const otros = perfiles.filter((p) => p.id !== actorId).map((p) => p.id)
    await enviarPush(admin, otros, {
      titulo: `${nombreDe(perfiles, actorId)} tachó ${nombreMes(mes)} ✓`,
      cuerpo: 'El mes quedó saldado.',
      url: '/',
      tag: `tachado-${mes}`,
    })
  } catch {
    /* best-effort */
  }
}

/** Neto a transferir de un mes (compartido, ajustes incluidos), o null si está a mano. */
export async function netoDelMes(admin: SupabaseClient, mes: string) {
  const [{ data: movs }, perfiles] = await Promise.all([
    admin
      .from('movimientos')
      .select('monto, pagado_por, prop_pagador, es_personal')
      .gte('fecha', `${mes}-01`)
      .lte('fecha', `${mes}-31`),
    perfilesDe(admin),
  ])
  if (perfiles.length !== 2) return null
  const [p1, p2] = perfiles
  const compartidos = (movs ?? []).filter((m) => !m.es_personal)
  const puso = calcularBalance(compartidos, perfiles)
  const diff = (puso.get(p1.id) ?? 0) - (puso.get(p2.id) ?? 0)
  if (Math.abs(diff) < 1) return null
  return {
    monto: Math.abs(diff),
    deudor: diff > 0 ? p2 : p1,
    acreedor: diff > 0 ? p1 : p2,
  }
}

/** Texto de saldo para el bot de WhatsApp + el mes anterior si quedó por tachar. */
export async function resumenSaldo(admin: SupabaseClient) {
  const mesActual = hoyArgentina().slice(0, 7)
  const anterior = mesShift(mesActual, -1)
  const { data: saldados } = await admin.from('meses_saldados').select('mes')
  const tachado = new Set((saldados ?? []).map((s) => s.mes))

  const lineas: string[] = []
  let paraTachar: { mes: string; neto: NonNullable<Awaited<ReturnType<typeof netoDelMes>>> } | null =
    null

  for (const mes of [anterior, mesActual]) {
    if (tachado.has(mes)) continue
    const neto = await netoDelMes(admin, mes)
    if (!neto) continue
    const enCurso = mes === mesActual ? ' (en curso)' : ''
    lineas.push(
      `${nombreMes(mes)}${enCurso}: ${neto.deudor.nombre} le debe ${plata(neto.monto)} a ${neto.acreedor.nombre}`
    )
    if (mes === anterior) paraTachar = { mes, neto }
  }

  const texto = lineas.length
    ? `📒 La libreta\n${lineas.join('\n')}`
    : '📒 La libreta\nA mano ✓ — no hay nada pendiente.'
  return { texto, paraTachar }
}

/**
 * Recordatorios del cron diario:
 *  - fijos que vencen hoy y no están cargados
 *  - cierre del mes anterior (días 1, 3 y 5, hasta que lo tachen)
 */
export async function recordatoriosDiarios(admin: SupabaseClient) {
  const hoy = hoyArgentina()
  const dia = Number(hoy.slice(8, 10))
  const mesActual = hoy.slice(0, 7)

  // --- fijos que vencen hoy ---
  const [{ data: fijos }, { data: movsMes }, { data: deudas }] = await Promise.all([
    admin.from('gastos_fijos').select('*').eq('activo', true),
    admin
      .from('movimientos')
      .select('descripcion, es_personal')
      .gte('fecha', `${mesActual}-01`)
      .lte('fecha', `${mesActual}-31`),
    admin.from('deudas').select('descripcion, created_at, fecha_primera_cuota'),
  ])
  const vencenHoy = (fijos ?? []).filter((f) => {
    if (f.dia_vencimiento !== dia) return false
    if (f.paga_tercero) {
      return !(deudas ?? []).some(
        (d) =>
          coincideNombre(d.descripcion, f.nombre) &&
          (String(d.created_at ?? '').startsWith(mesActual) ||
            String(d.fecha_primera_cuota ?? '').startsWith(mesActual))
      )
    }
    return !(movsMes ?? []).some(
      (m) => !m.es_personal && coincideNombre(m.descripcion, f.nombre)
    )
  })
  if (vencenHoy.length > 0) {
    await enviarPush(admin, null, {
      titulo: '📌 Vencimiento de hoy',
      cuerpo: `Falta cargar: ${vencenHoy.map((f) => f.nombre).join(', ')}.`,
      url: '/nuevo',
      tag: 'vencimientos',
    })
  }

  // --- cierre del mes anterior ---
  if ([1, 3, 5].includes(dia)) {
    const anterior = mesShift(mesActual, -1)
    const { data: saldado } = await admin
      .from('meses_saldados')
      .select('mes')
      .eq('mes', anterior)
      .maybeSingle()
    if (!saldado) {
      const neto = await netoDelMes(admin, anterior)
      if (neto) {
        await enviarPush(admin, null, {
          titulo: `📒 Cerrar ${nombreMes(anterior)}`,
          cuerpo: `${neto.deudor.nombre} le transfiere ${plata(neto.monto)} a ${neto.acreedor.nombre} y lo tachan.`,
          url: '/',
          tag: 'cierre-mes',
        })
      }
    }
  }

  return { vencimientos: vencenHoy.length }
}
