import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { registrarGasto } from '@/lib/ingesta'
import { textoWhatsApp, botonesWhatsApp } from '@/lib/whatsapp'
import { resumenSaldo, netoDelMes, avisarTachado } from '@/lib/avisos'
import { sinAcentos } from '@/lib/parsear-gasto'

// GET: verificación del webhook de Meta
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const mode = searchParams.get('hub.mode')
  const token = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 })
  }

  return new NextResponse('Forbidden', { status: 403 })
}

const soloDigitos = (s: string) => s.replace(/\D/g, '')

// POST: recibe mensajes de WhatsApp
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    const entry = body?.entry?.[0]?.changes?.[0]?.value
    if (!entry) return NextResponse.json({ status: 'ignored' })

    const message = entry.messages?.[0]
    if (!message) return NextResponse.json({ status: 'ignored' })

    const from = message.from

    // Respuesta a botón interactivo (el "✓ Tachar" del mes anterior)
    if (message.type === 'interactive' && message.interactive?.type === 'button_reply') {
      const buttonId: string = message.interactive.button_reply.id
      if (buttonId.startsWith('tachar:')) {
        const mes = buttonId.slice(7) // 'YYYY-MM'
        const supabase = createAdminClient()
        const { data: perfiles } = await supabase.from('profiles').select('id, nombre, telefono')
        const perfil = perfiles?.find(
          (p) => p.telefono && soloDigitos(p.telefono) === soloDigitos(from)
        )
        if (!perfil) {
          await textoWhatsApp(from, 'Tu número no está vinculado. Cargalo en la base.')
          return NextResponse.json({ status: 'ok' })
        }
        const neto = await netoDelMes(supabase, mes)
        const monto = neto ? Math.round(neto.monto * 100) / 100 : null
        const { error } = await supabase
          .from('meses_saldados')
          .upsert({ mes, monto, saldado_por: perfil.id }, { onConflict: 'mes' })
        if (error) {
          await textoWhatsApp(from, 'No pude tachar el mes. Intentá desde la app.')
        } else {
          await avisarTachado(supabase, mes, perfil.id)
          await textoWhatsApp(from, '✓ Mes tachado. Saldo saldado.')
        }
      }
      return NextResponse.json({ status: 'ok' })
    }

    if (message.type !== 'text') {
      return NextResponse.json({ status: 'ignored' })
    }

    const texto = message.text.body.trim()
    const norm = sinAcentos(texto)

    // Comando saldo / resumen
    if (norm === 'saldo' || norm === 'resumen') {
      const supabase = createAdminClient()
      const { texto: resumen, paraTachar } = await resumenSaldo(supabase)
      if (paraTachar) {
        await botonesWhatsApp(from, resumen, [
          { id: `tachar:${paraTachar.mes}`, titulo: '✓ Tachar' },
        ])
      } else {
        await textoWhatsApp(from, resumen)
      }
      return NextResponse.json({ status: 'ok' })
    }

    // Cargar gasto (texto libre: "12500 súper", "luz 45000", etc.)
    const resultado = await registrarGasto({ texto, telefono: from })
    await textoWhatsApp(from, resultado.mensaje)

    return NextResponse.json({ status: resultado.ok ? 'ok' : 'error' })
  } catch (err) {
    console.error('WhatsApp webhook error:', err)
    return NextResponse.json({ status: 'error' }, { status: 500 })
  }
}
