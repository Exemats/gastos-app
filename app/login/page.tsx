'use client'
import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const MENSAJES_ERROR: Record<string, string> = {
  denegado: 'Esa cuenta no está habilitada. Entrá con el Google de Mati o el de Vicky.',
  auth: 'El acceso falló o el link venció. Probá de nuevo.',
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  )
}

function LoginForm() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [conMail, setConMail] = useState(false)
  const [error, setError] = useState('')
  const params = useSearchParams()
  const supabase = createClient()

  async function loginGoogle() {
    setError('')
    setLoading(true)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${location.origin}/auth/callback` },
    })
    // si no hay error, el navegador ya se está yendo a Google
    if (error) {
      setError(error.message)
      setLoading(false)
    }
  }

  async function loginMail(e: React.FormEvent) {
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

  const errorParam = params.get('error')

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 pb-24">
      <div className="card p-6">
        <p className="mb-1 text-sm font-semibold uppercase tracking-widest text-birome">
          Mati &amp; Vicky
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
          <div className="grid gap-3">
            <button
              onClick={loginGoogle}
              disabled={loading}
              className="btn btn-secundario w-full !py-3"
            >
              <GoogleIcon />
              {loading ? 'Conectando…' : 'Entrar con Google'}
            </button>
            <p className="text-center text-xs text-tinta-suave">
              Una sola vez cada tanto: la sesión queda guardada en el celu.
            </p>

            {conMail ? (
              <form onSubmit={loginMail} className="mt-2 grid gap-3 border-t border-linea pt-4">
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
                <button className="btn btn-primario" disabled={loading || !email}>
                  {loading ? 'Enviando…' : 'Mandame el link de acceso'}
                </button>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setConMail(true)}
                className="text-center text-sm text-tinta-suave underline underline-offset-2"
              >
                ¿Problemas con Google? Entrá con un link por mail
              </button>
            )}

            {errorParam && !error && (
              <p className="text-sm text-rojo">
                {MENSAJES_ERROR[errorParam] ?? MENSAJES_ERROR.auth}
              </p>
            )}
            {error && <p className="text-sm text-rojo">{error}</p>}
          </div>
        )}
      </div>
      <p className="mt-4 text-center text-xs text-tinta-suave">
        Solo pueden entrar las cuentas de Mati y Vicky.
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
