import webpush from 'web-push'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Envío de notificaciones push web (VAPID). Server-only.
 * Si las claves no están configuradas, todo es un no-op silencioso.
 * Claves: npx web-push generate-vapid-keys
 */
export type CargaPush = {
  titulo: string
  cuerpo: string
  /** A dónde lleva el tap (default '/'). */
  url?: string
  /** Mismo tag = se reemplaza en vez de apilarse. */
  tag?: string
}

let configurado = false
function configurar() {
  const publica = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const privada = process.env.VAPID_PRIVATE_KEY
  if (!publica || !privada) return false
  if (!configurado) {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT ?? 'mailto:matiarona@gmail.com',
      publica,
      privada
    )
    configurado = true
  }
  return true
}

/**
 * Manda la notificación a todos los dispositivos de los perfiles dados
 * (null = a todos los perfiles). Limpia suscripciones muertas.
 */
export async function enviarPush(
  admin: SupabaseClient,
  destinatarios: string[] | null,
  carga: CargaPush
) {
  if (!configurar()) return
  let query = admin.from('push_subs').select('endpoint, subscription')
  if (destinatarios) {
    if (destinatarios.length === 0) return
    query = query.in('profile_id', destinatarios)
  }
  const { data: subs } = await query
  if (!subs?.length) return

  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          s.subscription as webpush.PushSubscription,
          JSON.stringify(carga)
        )
      } catch (e: unknown) {
        const status = (e as { statusCode?: number }).statusCode
        // suscripción vencida o dada de baja: se limpia sola
        if (status === 404 || status === 410) {
          await admin.from('push_subs').delete().eq('endpoint', s.endpoint)
        }
      }
    })
  )
}
