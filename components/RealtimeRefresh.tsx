'use client'
import { useRouter } from 'next/navigation'
import { useRealtime } from '@/lib/use-realtime'

/** Para páginas server (el dashboard): re-renderiza cuando cambia la base. */
export default function RealtimeRefresh() {
  const router = useRouter()
  useRealtime(() => router.refresh())
  return null
}
