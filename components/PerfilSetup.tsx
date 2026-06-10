'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Profile } from '@/lib/types'

/**
 * Aparece la primera vez que cada uno entra (el trigger crea el perfil
 * como 'Nuevo' / 0.500). Acá se elige quién sos y queda 65/35 sin SQL.
 */
export default function PerfilSetup({
  perfil,
  hayOtro,
}: {
  perfil: Profile
  hayOtro: boolean
}) {
  const router = useRouter()
  const supabase = createClient()
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  async function elegir(nombre: 'Mati' | 'Vicky') {
    setGuardando(true)
    setError('')
    const porcentaje = nombre === 'Mati' ? 0.65 : 0.35
    const { error } = await supabase
      .from('profiles')
      .update({ nombre, porcentaje })
      .eq('id', perfil.id)
    setGuardando(false)
    if (error) setError(error.message)
    else router.refresh()
  }

  if (perfil.nombre !== 'Nuevo') {
    return !hayOtro ? (
      <div className="card mb-4 border-birome bg-birome-suave p-4 text-sm">
        Falta que la otra persona entre con su mail por primera vez para que
        aparezca el saldo entre los dos.
      </div>
    ) : null
  }

  return (
    <div className="card mb-4 border-birome bg-birome-suave p-4">
      <p className="mb-3 font-semibold">¿Quién sos? (se configura una sola vez)</p>
      <div className="grid grid-cols-2 gap-3">
        <button
          className="btn btn-primario"
          disabled={guardando}
          onClick={() => elegir('Mati')}
        >
          Soy Mati (65%)
        </button>
        <button
          className="btn btn-secundario"
          disabled={guardando}
          onClick={() => elegir('Vicky')}
        >
          Soy Vicky (35%)
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-rojo">{error}</p>}
    </div>
  )
}
