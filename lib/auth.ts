/**
 * Únicas cuentas habilitadas para entrar a la libreta, con su perfil.
 * El gate real está en tres capas: el trigger handle_new_user en la base
 * (bloquea el alta de cualquier otro mail), el callback de auth (mensaje
 * amigable) y el middleware (mata sesiones de cuentas no habilitadas).
 */
export const PERFILES_HABILITADOS: Record<
  string,
  { nombre: string; porcentaje: number }
> = {
  'matiarona@gmail.com': { nombre: 'Mati', porcentaje: 0.65 },
  'vickyswag02@gmail.com': { nombre: 'Vicky', porcentaje: 0.35 },
}

export function emailHabilitado(email?: string | null) {
  return Boolean(email && PERFILES_HABILITADOS[email.trim().toLowerCase()])
}

export function perfilPorEmail(email?: string | null) {
  if (!email) return null
  return PERFILES_HABILITADOS[email.trim().toLowerCase()] ?? null
}
