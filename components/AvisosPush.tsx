'use client'
import { useEffect, useState } from 'react'

/**
 * Activa las notificaciones push en este dispositivo: gastos que carga el
 * otro, vencimientos de fijos, cierre de mes y límites pasados.
 * En iPhone requiere la app instalada en la pantalla de inicio (iOS 16.4+).
 */
function base64aUint8(base64: string) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const crudo = atob(b64)
  return Uint8Array.from([...crudo].map((c) => c.charCodeAt(0)))
}

export default function AvisosPush() {
  const [estado, setEstado] = useState<'oculto' | 'pedir' | 'activando' | 'activo'>('oculto')
  const [error, setError] = useState('')

  useEffect(() => {
    async function revisar() {
      const clave = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
      if (
        !clave ||
        !('serviceWorker' in navigator) ||
        !('PushManager' in window) ||
        !('Notification' in window) ||
        Notification.permission === 'denied'
      ) {
        return // sin soporte o bloqueado: no molestamos
      }
      try {
        const reg = await navigator.serviceWorker.ready
        const sub = await reg.pushManager.getSubscription()
        setEstado(sub ? 'activo' : 'pedir')
      } catch {
        /* sin SW: nada */
      }
    }
    revisar()
  }, [])

  async function activar() {
    setError('')
    setEstado('activando')
    try {
      const permiso = await Notification.requestPermission()
      if (permiso !== 'granted') {
        setEstado('oculto')
        return
      }
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64aUint8(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!),
      })
      const r = await fetch('/api/push/suscribir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: sub.toJSON() }),
      })
      if (!r.ok) throw new Error('No se pudo guardar la suscripción.')
      setEstado('activo')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo activar.')
      setEstado('pedir')
    }
  }

  if (estado !== 'pedir' && estado !== 'activando') return null

  return (
    <div className="card mb-4 flex flex-wrap items-center justify-between gap-2 px-4 py-3">
      <p className="text-sm">
        🔔 <span className="font-medium">Activá los avisos en este dispositivo</span>
        <span className="block text-xs text-tinta-suave">
          Gastos del otro, vencimientos, cierre de mes y límites.
        </span>
        {error && <span className="block text-xs text-rojo">{error}</span>}
      </p>
      <button
        className="btn btn-secundario !px-3 !py-1.5 !text-sm"
        disabled={estado === 'activando'}
        onClick={activar}
      >
        {estado === 'activando' ? 'Activando…' : 'Activar'}
      </button>
    </div>
  )
}
