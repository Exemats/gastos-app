import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/admin'
import { parsearGasto } from '@/lib/parsear-gasto'
import { registrarIngesta } from '@/lib/ingesta'

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

// POST: recibe mensajes de WhatsApp
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    const entry = body?.entry?.[0]
    const changes = entry?.changes?.[0]
    const value = changes?.value
    const message = value?.messages?.[0]

    if (!message || message.type !== 'text') {
      return NextResponse.json({ status: 'ignored' })
    }

    const from = message.from // número del que escribe, ej: 5491112345678
    const texto = message.text.body.trim()

    // Buscar quién es por teléfono
    const supabase = createClient()
    const { data: perfil } = await supabase
      .from('profiles')
      .select('id, nombre')
      .eq('telefono', from)
      .single()

    if (!perfil) {
      await enviarMensaje(from, '❌ Tu número no está registrado en la app.')
      return NextResponse.json({ status: 'unknown_user' })
    }

    // Parsear y registrar el gasto
    const gasto = parsearGasto(texto, perfil.nombre)
    const resultado = await registrarIngesta({ ...gasto, userId: perfil.id })

    if (!resultado.ok) {
      await enviarMensaje(from, `❌ No pude registrar el gasto: ${resultado.error}`)
      return NextResponse.json({ status: 'error' })
    }

    const confirmacion = `✅ Anotado ✓\n💰 $${gasto.monto.toLocaleString('es-AR')}\n📝 ${gasto.descripcion}\n👤 Pagó: ${perfil.nombre}`
    await enviarMensaje(from, confirmacion)

    return NextResponse.json({ status: 'ok' })
  } catch (err) {
    console.error('WhatsApp webhook error:', err)
    return NextResponse.json({ status: 'error' }, { status: 500 })
  }
}

async function enviarMensaje(to: string, texto: string) {
  await fetch(
    `https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_ID}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: texto },
      }),
    }
  )
}