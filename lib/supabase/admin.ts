import { createClient } from '@supabase/supabase-js'

/**
 * Cliente con service role: salta RLS. SOLO para route handlers del servidor
 * (/api/ingesta y /api/whatsapp), que se autentican por token propio.
 * Nunca importar desde componentes.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('Falta SUPABASE_SERVICE_ROLE_KEY o NEXT_PUBLIC_SUPABASE_URL en el entorno.')
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
