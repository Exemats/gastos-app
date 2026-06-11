import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { recordatoriosDiarios } from '@/lib/avisos'

/**
 * Cron diario (vercel.json, 13:00 UTC = 10:00 de Argentina):
 * fijos que vencen hoy sin cargar + recordatorio de cierre (días 1, 3 y 5).
 * Vercel manda Authorization: Bearer CRON_SECRET si la env está definida.
 */
export async function GET(request: Request) {
  const secreto = process.env.CRON_SECRET
  if (secreto && request.headers.get('authorization') !== `Bearer ${secreto}`) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }
  try {
    const resultado = await recordatoriosDiarios(createAdminClient())
    return NextResponse.json({ ok: true, ...resultado })
  } catch (e) {
    return NextResponse.json(
      { ok: false, mensaje: e instanceof Error ? e.message : 'error' },
      { status: 500 }
    )
  }
}
