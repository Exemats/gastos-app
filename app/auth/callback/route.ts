import { createClient } from '@/lib/supabase/server'
import { emailHabilitado, perfilPorEmail } from '@/lib/auth'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/'

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user || !emailHabilitado(user.email)) {
        await supabase.auth.signOut()
        return NextResponse.redirect(`${origin}/login?error=denegado`)
      }

      // Primera vez: el trigger crea el perfil como 'Nuevo' y acá se
      // corrige solo según el mail (Mati 65% / Vicky 35%). Sin pantallas.
      const datos = perfilPorEmail(user.email)
      if (datos) {
        await supabase
          .from('profiles')
          .update({ nombre: datos.nombre, porcentaje: datos.porcentaje })
          .eq('id', user.id)
          .eq('nombre', 'Nuevo')
      }

      return NextResponse.redirect(`${origin}${next}`)
    }
  }
  return NextResponse.redirect(`${origin}/login?error=auth`)
}
