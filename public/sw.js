// Service worker mínimo: habilita la instalación como PWA.
// Pass-through a la red (la app necesita Supabase online igual).
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))
self.addEventListener('fetch', () => {})
