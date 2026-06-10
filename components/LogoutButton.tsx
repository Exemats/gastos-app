'use client'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export default function LogoutButton() {
  const router = useRouter()
  const supabase = createClient()
  async function logout() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }
  return (
    <button onClick={logout} className="text-sm font-medium text-tinta-suave underline underline-offset-2">
      Salir
    </button>
  )
}
