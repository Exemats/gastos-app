import { registrarGasto } from '@/lib/ingesta'

/**
 * Webhook de WhatsApp (Meta Cloud API). Mandás "12500 súper" al número
 * del bot y queda anotado; el bot contesta la confirmación.
 *
 * Env necesarias:
 *   WHATSAPP_VERIFY_TOKEN  inventado por vos, para verificar el webhook
 *   WHATSAPP_TOKEN         token de acceso de la app de Meta (para responder)
 *   WHATSAPP_PHONE_ID      id del número de teléfono del bot
 *   WHATSAPP_APP_SECRET    (recomendado) valida la firma de cada payload
 *
 * El remitente se identifica matcheando su número contra profiles.telefono.
 */

// GET: verificación del webhook al configurarlo en Meta
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const verificado =
    searchParams.get('hub.mode') === 'subscribe' &&
    Boolean(process.env.WHATSAPP_VERIFY_TOKEN) &&
    searchParams.get('hub.verify_token') === process.env.WHATSAPP_VERIFY_TOKEN
  if (verificado) {
    return new Response(searchParams.get('hub.challenge') ?? '', { status: 200 })
  }
  return new Response('Forbidden', { status: 403 })
}

async function firmaValida(raw: string, firma: string | null) {
  const secreto = process.env.WHATSAPP_APP_SECRET
  if (!secreto) return true // sin app secret configurado no se valida (mejor ponerlo)
  if (!firma?.startsWith('sha256=')) return false
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secreto),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(raw))
  const hex = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return hex === firma.slice('sha256='.length)
}

async function responder(a: string, texto: string) {
  const token = process.env.WHATSAPP_TOKEN
  const phoneId = process.env.WHATSAPP_PHONE_ID
  if (!token || !phoneId) return
  try {
    await fetch(`https://graph.facebook.com/v23.0/${phoneId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: a,
        text: { body: texto },
      }),
    })
  } catch {
    // responder es best-effort; el gasto ya quedó (o no) registrado
  }
}

type MensajeWhatsApp = { type?: string; from?: string; text?: { body?: string } }

export async function POST(request: Request) {
  const raw = await request.text()
  if (!(await firmaValida(raw, request.headers.get('x-hub-signature-256')))) {
    return new Response('Bad signature', { status: 401 })
  }

  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    return new Response('OK', { status: 200 })
  }

  // estructura del webhook: entry[].changes[].value.messages[]
  const entradas = (payload as { entry?: { changes?: { value?: { messages?: MensajeWhatsApp[] } }[] }[] })
    ?.entry ?? []
  const mensajes = entradas
    .flatMap((e) => e?.changes ?? [])
    .flatMap((c) => c?.value?.messages ?? [])

  for (const msg of mensajes) {
    if (msg?.type !== 'text' || !msg.from) continue
    const texto = msg.text?.body ?? ''
    const r = await registrarGasto({ texto, telefono: msg.from })
    await responder(msg.from, r.mensaje)
  }

  // siempre 200 rápido para que Meta no reintente
  return new Response('OK', { status: 200 })
}
