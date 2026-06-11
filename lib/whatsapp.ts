/**
 * Envío de mensajes por WhatsApp Cloud API (Meta). Server-only.
 * Sin WHATSAPP_TOKEN / WHATSAPP_PHONE_ID configurados es un no-op.
 */
async function enviar(a: string, payload: Record<string, unknown>) {
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
      body: JSON.stringify({ messaging_product: 'whatsapp', to: a, ...payload }),
    })
  } catch {
    // best-effort: el dato ya está guardado, la respuesta es cortesía
  }
}

export function textoWhatsApp(a: string, texto: string) {
  return enviar(a, { text: { body: texto } })
}

/** Mensaje con botones de respuesta rápida (máx 3, títulos de hasta 20 chars). */
export function botonesWhatsApp(
  a: string,
  texto: string,
  botones: { id: string; titulo: string }[]
) {
  return enviar(a, {
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: texto },
      action: {
        buttons: botones.slice(0, 3).map((b) => ({
          type: 'reply',
          reply: { id: b.id, title: b.titulo.slice(0, 20) },
        })),
      },
    },
  })
}
