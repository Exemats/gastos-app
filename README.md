# Gastos · Mati & Vicky — "La libreta"

App de gastos compartidos del depto: carga rápida de gastos, deudas en cuotas
y saldo neto entre los dos calculado solo. Next.js 15 (App Router) + Supabase
+ Tailwind 4. PWA instalable en el celular.

## Qué incluye (todas las fases del plan, menos la 7)

- **Auth por magic link** (Supabase): middleware que protege todo, login, callback, logout.
- **Dashboard (`/`)**: saldo neto grande ("Le debés a Vicky $X" / "Vicky te debe $X"),
  gastado del mes, cuotas del mes, últimos movimientos.
- **Cargar gasto (`/nuevo`)**: monto + descripción + quién pagó, categorías como
  botones, catálogo de gastos fijos (luz, gas, etc.) con un tap, checkbox
  "100% de quien lo pagó" (usa `prop_pagador = 1`).
- **Deudas (`/deudas`)**: cuotas con barra de progreso, "Pagué una cuota"
  (auto-cierra al llegar al total), alta de deuda a terceros o entre ustedes.
- **Historial (`/historial`)**: filtros por mes / tipo / persona, total filtrado, borrar.
- **Saldar saldo**: botón en el dashboard que registra un "Pago de saldo"
  (`prop_pagador = 0`, categoría `ajuste`) y deja el balance en cero. No requiere
  cambios de esquema.
- **Setup de perfil sin SQL**: la primera vez que cada uno entra, elige
  "Soy Mati (65%)" o "Soy Vicky (35%)" y el perfil se corrige solo.
- **PWA**: manifest + service worker + íconos → instalable desde el navegador del celu.

## Cómo correrla local (Windows)

```powershell
cd gastos-app
npm install
npm run dev
```

Abrí http://localhost:3000 → te redirige a `/login`.

El `.env.local` **ya viene incluido** en el zip, generado en UTF-8 sin BOM con
fin de línea LF — esto resuelve el problema de encoding que tenías con el
archivo creado desde VS Code en Windows. No lo edites con Notepad; si alguna
vez necesitás recrearlo, usá el comando de PowerShell del plan o copiá
`.env.example`.

## Base de datos

El esquema es **el mismo que ya corriste en Supabase** (`docs/supabase_schema.sql`,
incluido como referencia). No hay que correr nada de nuevo: la app usa
`profiles`, `movimientos`, `deudas` y `gastos_fijos` tal como están.
El balance se calcula en la app con la misma lógica que `balance_view`, pero
sin depender de los nombres hardcodeados 'Mati'/'Vicky' (más robusto).

## Configuración de Supabase Auth (una vez)

1. Authentication → URL Configuration:
   - Site URL: `http://localhost:3000` (en dev) o tu URL de Vercel (en prod).
   - Redirect URLs: `http://localhost:3000/**` y `https://TU-APP.vercel.app/**`.
2. **Importante (seguridad):** cuando los dos ya se hayan logueado al menos una
   vez, andá a Authentication → Sign In / Up y **desactivá "Allow new users to
   sign up"**. Las policies actuales dejan leer/escribir a cualquier usuario
   autenticado, así que conviene cerrar el registro a terceros.

## Deploy en Vercel

1. Subí el código al repo (`github.com/Exemats/gastos-app`):
   ```powershell
   git add -A
   git commit -m "App completa: dashboard, carga, deudas, historial, PWA"
   git push
   ```
2. En Vercel → Project → Settings → Environment Variables, cargá
   `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY` (los mismos
   valores del `.env.local`).
3. Redeploy. Agregá la URL de Vercel a los Redirect URLs de Supabase.

## Instalar como app en el celular

Abrí la URL de Vercel en el navegador del celu → menú → "Agregar a pantalla de
inicio" / "Instalar app". Queda con ícono propio y pantalla completa.

## Decisiones tomadas (para que las revises)

- **Balance calculado en la app**, no vía `balance_view`, para no depender de
  que los nombres en `profiles` sean exactamente 'Mati'/'Vicky'. La view sigue
  existiendo y sirve para chequear desde el SQL Editor.
- **Pago de saldo** = movimiento con `prop_pagador = 0` y categoría `ajuste`.
  Se excluye de los totales de "gastado del mes" para no inflarlos.
- Las **deudas a terceros no entran al saldo neto** entre ustedes (como estaba
  decidido); se trackean cuota a cuota en `/deudas`.
- "Pagué una cuota" tiene **Deshacer** (resta una cuota y reactiva) por si se
  toca de más.
- Formato de plata: `es-AR`, sin decimales en pantalla (los centavos viven en la DB).
- Fase 7 (ingreso por email/lenguaje natural) queda afuera, como estaba
  planificado; el modelo de datos ya la soporta.

## Estructura

```
app/
  page.tsx            dashboard
  nuevo/page.tsx      carga rápida
  deudas/page.tsx     cuotas
  historial/page.tsx  historial filtrable
  login/page.tsx      magic link
  auth/callback/      intercambio de código por sesión
components/           Nav, LogoutButton, PerfilSetup, SaldarButton, SwRegister
lib/supabase/         clientes browser/server (@supabase/ssr)
lib/format.ts         plata, fechas y cálculo de balance
middleware.ts         protección de rutas + refresh de sesión
public/               manifest, sw.js, íconos PWA
docs/                 supabase_schema.sql (referencia)
```
