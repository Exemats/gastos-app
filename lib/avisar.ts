/**
 * Aviso fire-and-forget desde el cliente después de cargar algo:
 * dispara el push al otro. keepalive aguanta la navegación posterior
 * y cualquier error se ignora (el aviso nunca es crítico).
 */
export function avisar(cuerpo: {
  tipo: 'gasto' | 'deuda' | 'tachado'
  id?: string
  mes?: string
}) {
  try {
    fetch('/api/push/avisar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
      keepalive: true,
    }).catch(() => {})
  } catch {
    /* sin red, sin drama */
  }
}
