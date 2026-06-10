'use client'
import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

function LoginForm() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const params = useSearchParams()
  const supabase = createClient()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${location.origin}/auth/callback` },
    })
    setLoading(false)
    if (error) setError(error.message)
    else setSent(true)
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 pb-24">
      <div className="card p-6">
        <p className="mb-1 text-sm font-semibold uppercase tracking-widest text-birome">
          Mati & Vicky
        </p>
        <h1 className="mb-6 text-3xl">La libreta de gastos</h1>

        {sent ? (
          <div className="rounded-lg bg-verde-suave p-4 text-verde">
            <p className="font-semibold">Revisá tu mail</p>
            <p className="mt-1 text-sm">
              Te mandamos un link a <span className="font-semibold">{email}</span>.
              Tocalo para entrar — no hace falta contraseña.
            </p>
          </div>
        ) : (
          <form onSubmit={handleLogin} className="grid gap-3">
            <label className="text-sm font-medium" htmlFor="email">
              Tu email
            </label>
            <input
              id="email"
              className="input"
              type="email"
              required
              autoComplete="email"
              placeholder="vos@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <button className="btn btn-primario mt-1" disabled={loading || !email}>
              {loading ? 'Enviando…' : 'Mandame el link de acceso'}
            </button>
            {params.get('error') && !error && (
              <p className="text-sm text-rojo">
                El link venció o ya se usó. Pedí uno nuevo.
              </p>
            )}
            {error && <p className="text-sm text-rojo">{error}</p>}
          </form>
        )}
      </div>
      <p className="mt-4 text-center text-xs text-tinta-suave">
        Entrás con un link mágico que llega a tu correo.
      </p>
    </main>
  )
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}
