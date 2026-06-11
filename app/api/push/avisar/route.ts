import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { emailHabilitado } from '@/lib/auth'
import { avisarMovimiento, avisarDeuda, avisarTachado } from '@/lib/avisos'

/**
 * La app avisa acá después de cargar algo, para que al otro le llegue el
 * push. El que llama se autentica por sesión; el contenido del aviso se
 * relee de la base (no se confía en texto del cliente).
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user || !emailHabilitado(user.email)) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }

  let body: { tipo?: string; id?: string; mes?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 })
  }

  const admin = createAdminClient()
  if (body.tipo === 'gasto' && body.id) {
    await avisarMovimiento(admin, body.id, user.id)
  } else if (body.tipo === 'deuda' && body.id) {
    await avisarDeuda(admin, body.id, user.id)
  } else if (body.tipo === 'tachado' && body.mes) {
    await avisarTachado(admin, body.mes, user.id)
  } else {
    return NextResponse.json({ ok: false }, { status: 400 })
  }
  return NextResponse.json({ ok: true })
}
