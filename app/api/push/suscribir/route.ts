import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { emailHabilitado } from '@/lib/auth'

/**
 * Alta/baja de la suscripción push de ESTE dispositivo.
 * Autentica por la sesión (cookies), igual que el resto de la app.
 */
async function usuarioValido() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user || !emailHabilitado(user.email)) return null
  return user
}

export async function POST(request: Request) {
  const user = await usuarioValido()
  if (!user) return NextResponse.json({ ok: false }, { status: 401 })

  let body: { subscription?: { endpoint?: string } }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 })
  }
  const sub = body.subscription
  if (!sub?.endpoint || typeof sub.endpoint !== 'string') {
    return NextResponse.json({ ok: false, mensaje: 'Suscripción inválida.' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { error } = await admin.from('push_subs').upsert(
    { endpoint: sub.endpoint, profile_id: user.id, subscription: sub },
    { onConflict: 'endpoint' }
  )
  if (error) {
    return NextResponse.json({ ok: false, mensaje: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

export async function DELETE(request: Request) {
  const user = await usuarioValido()
  if (!user) return NextResponse.json({ ok: false }, { status: 401 })
  let body: { endpoint?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 })
  }
  if (!body.endpoint) return NextResponse.json({ ok: false }, { status: 400 })
  const admin = createAdminClient()
  await admin
    .from('push_subs')
    .delete()
    .eq('endpoint', body.endpoint)
    .eq('profile_id', user.id)
  return NextResponse.json({ ok: true })
}
