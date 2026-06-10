import { registrarGasto } from '@/lib/ingesta'
import { createAdminClient } from '@/lib/supabase/admin'
import { textoWhatsApp, botonesWhatsApp } from '@/lib/whatsapp'
import { resumenSaldo, netoDelMes, avisarTachado } from '@/lib/avisos'
import { sinAcentos } from '@/lib/parsear-gasto'
import { nombreMes, nombreMesCorto, plata } from '@/lib/format'

/**
 * Webhook de WhatsApp (Meta Cloud API). Mandás "12500 súper" al número
 * del bot y queda anotado; el bot contesta la confirmación. Además:
 *   - "saldo" / "resumen": estado actual + botón para tachar el mes
 *     anterior si quedó pendiente (botones nativos de Meta).
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

type MensajeWhatsApp = {
  type?: string
  from?: string
  text?: { body?: string }
  interactive?: { button_reply?: { id?: string } }
}

const soloDigitos = (s: string) => s.replace(/\D/g, '')

async function perfilPorTelefono(telefono: string) {
  const admin = createAdminClient()
  const { data } = await admin.from('profiles').select('id, nombre, telefono')
  return (
    (data ?? []).find(
      (p) => p.telefono && soloDigitos(p.telefono) === soloDigitos(telefono)
    ) ?? null
  )
}

/** "saldo" / "resumen": estado + botón de tachar si el mes pasado está pendiente. */
async function responderSaldo(a: string) {
  const admin = createAdminClient()
  const { texto, paraTachar } = await resumenSaldo(admin)
  if (paraTachar) {
    await botonesWhatsApp(a, texto, [
      { id: `tachar_${paraTachar.mes}`, titulo: `✓ Tachar ${nombreMesCorto(paraTachar.mes)}` },
    ])
  } else {
    await textoWhatsApp(a, texto)
  }
}

/** Botón "✓ Tachar {mes}": registra el tachado como si fuera desde la app. */
async function tacharDesdeChat(a: string, mes: string) {
  const admin = createAdminClient()
  const perfil = await perfilPorTelefono(a)
  if (!perfil) {
    await textoWhatsApp(a, 'Tu número no está vinculado a ningún perfil.')
    return
  }
  const neto = await netoDelMes(admin, mes)
  const { error } = await admin.from('meses_saldados').upsert(
    {
      mes,
      monto: neto ? Math.round(neto.monto * 100) / 100 : null,
      saldado_por: perfil.id,
    },
    { onConflict: 'mes' }
  )
  if (error) {
    await textoWhatsApp(a, `No pude tachar: ${error.message}`)
    return
  }
  await avisarTachado(admin, mes, perfil.id)
  await textoWhatsApp(
    a,
    `✓ ${nombreMes(mes)} tachado${neto ? ` (se transfirieron ${plata(neto.monto)})` : ''}. A mano.`
  )
}

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
  const entradas =
    (payload as { entry?: { changes?: { value?: { messages?: MensajeWhatsApp[] } }[] }[] })
      ?.entry ?? []
  const mensajes = entradas
    .flatMap((e) => e?.changes ?? [])
    .flatMap((c) => c?.value?.messages ?? [])

  for (const msg of mensajes) {
    if (!msg?.from) continue

    // botón "✓ Tachar {mes}"
    if (msg.type === 'interactive') {
      const id = msg.interactive?.button_reply?.id
      if (id?.startsWith('tachar_')) await tacharDesdeChat(msg.from, id.slice(7))
      continue
    }

    if (msg.type !== 'text') continue
    const texto = msg.text?.body ?? ''
    const comando = sinAcentos(texto.trim())

    if (comando === 'saldo' || comando === 'resumen') {
      await responderSaldo(msg.from)
      continue
    }

    const r = await registrarGasto({ texto, telefono: msg.from })
    await textoWhatsApp(msg.from, r.mensaje)
  }

  // siempre 200 rápido para que Meta no reintente
  return new Response('OK', { status: 200 })
}
