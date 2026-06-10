'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  {
    href: '/',
    label: 'Inicio',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/></svg>
    ),
  },
  {
    href: '/nuevo',
    label: 'Cargar',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>
    ),
  },
  {
    href: '/deudas',
    label: 'Cuotas',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/></svg>
    ),
  },
  {
    href: '/historial',
    label: 'Historial',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 3"/></svg>
    ),
  },
]

export default function Nav() {
  const pathname = usePathname()
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-linea bg-white/95 backdrop-blur">
      <div className="mx-auto grid max-w-md grid-cols-4">
        {TABS.map((t) => {
          const activo = pathname === t.href
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium ${
                activo ? 'text-birome' : 'text-tinta-suave'
              }`}
            >
              {t.icon}
              {t.label}
            </Link>
          )
        })}
      </div>
      <div className="h-[env(safe-area-inset-bottom)]" />
    </nav>
  )
}
