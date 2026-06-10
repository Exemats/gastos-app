# Gastos · Mati & Vicky — "La libreta"

App de gastos compartidos del depto: carga rápida, deudas en cuotas, saldo
neto entre los dos calculado solo, resumen por persona y sección privada de
gastos personales. Next.js 15 (App Router) + Supabase + Tailwind 4. PWA
instalable en el celular.

## Qué incluye

- **Login con Google** (un tap, sin contraseñas) restringido a las cuentas de
  Mati y Vicky. La sesión queda guardada en el celu y se renueva sola: se
  loguean una vez cada tanto, no cada vez. Queda el magic link por mail como
  plan B.
- **Perfil automático**: al entrar por primera vez con tu mail, el perfil se
  crea ya como Mati (65%) o Vicky (35%). Sin pantallas de setup.
- **Cierre mensual con "tachado"**: cada gasto cuenta en el mes de su fecha.
  A principio de mes se mira cuánto dio el mes anterior, se transfiere la
  diferencia y se **tacha** ese mes (sin cargar ningún movimiento de
  transferencia). Lo que se debe = la suma de los meses sin tachar.
- **División según las reglas de la casa**: los gastos del depto se dividen
  por porcentaje (65/35); los **servicios (luz, gas, internet, agua, ABL) se
  dividen mitad y mitad**; las **expensas las paga Seba** y al cargarlas se
  anota la mitad como deuda con Seba (junto a las demás deudas con él), sin
  tocar el saldo entre ustedes. Las reglas viven en el catálogo
  `gastos_fijos` (`prop_pagador`, `paga_tercero`) y se pueden cambiar ahí.
- **Dashboard (`/`)**: saldo pendiente grande ("Le debés a Vicky $X" /
  "Vicky te debe $X") con el detalle mes por mes y el botón de tachar;
  recordatorio de **fijos que faltan cargar este mes** (un tap y se cargan);
  gastado del mes, cuotas del mes, tus personales del mes y últimos
  movimientos.
- **Resumen (`/resumen`)**: mes por mes, quién pagó cuánto de lo compartido,
  la parte que le tocaba a cada uno y el neto del mes; el estado del cierre
  (saldado ✓ / a transferir / en curso, con deshacer); evolución de los
  últimos 6 meses apilada por persona y comparativa con el mes anterior;
  gastos por categoría; deudas activas por persona; botón **"copiar resumen
  del mes"** listo para pegar en el chat; y la lista completa de movimientos
  con búsqueda, filtros, **export CSV** y **corrección manual** (lápiz:
  monto, fecha, categoría, quién pagó y cómo se divide). En el celular la
  lista va en desplegables por categoría; en pantalla grande es una tabla y
  el resumen queda a la izquierda con gráficos a la derecha. La URL
  `/historial` redirige acá.
- **Personal (`/personal`)** 🔒: gastos personales de cada uno. No se dividen,
  no tocan el saldo y **el otro no los ve** — lo garantiza Row Level Security
  en la base, no solo la pantalla.
- **Cargar (`/nuevo`)**: toggle Compartido / Personal, monto + descripción
  con autocompletado de lo que ya cargaron, quién pagó, categorías y catálogo
  de fijos con un tap (cada fijo aplica su regla de división sola; Expensas
  muestra "lo paga Seba" y anota la deuda), checkbox "100% de quien lo pagó".
- **Deudas (`/deudas`)**: cuotas con progreso, "Pagué una cuota" con deshacer,
  deudas a terceros o entre ustedes.
- **Carga sin abrir la app**: bot de WhatsApp ("12500 súper" y listo),
  Google Forms, atajos del celu y compartir texto a la app (Android). Ver
  abajo.

## Cómo correrla local

```bash
npm install
npm run dev
```

Abrí http://localhost:3000 → te redirige a `/login`. Necesitás `.env.local`
(copiá `.env.example` y completá).

## Puesta al día (si venís de la versión anterior)

1. **Correr `docs/migracion_v2.sql`** en Supabase > SQL Editor (idempotente).
   Agrega `es_personal`, `profiles.telefono`, la tabla `meses_saldados` (el
   tachado), las reglas de división de los fijos (servicios mitad y mitad,
   Expensas → deuda con Seba), las policies de privacidad y el trigger que
   solo deja existir a sus dos cuentas (perfil automático incluido). **Sin
   este paso la app avisa con un cartel y funciona en modo básico** (sin
   personales ni tachado).
2. **Habilitar Google** como provider (sección siguiente).
3. **Deployar** con las env vars nuevas (`.env.example`).

El esquema original sigue en `docs/supabase_schema.sql` como referencia.

## Login con Google (una vez)

1. En [Google Cloud Console](https://console.cloud.google.com/apis/credentials):
   creá un proyecto (si no tenés) → **Credentials → Create credentials →
   OAuth client ID → Web application**.
   - Authorized redirect URI: `https://TU-PROYECTO.supabase.co/auth/v1/callback`
     (la URL exacta te la muestra Supabase en el paso 2).
   - Si pide configurar la pantalla de consentimiento: tipo External, agregá
     los dos mails como test users o publicala (es solo para ustedes dos).
2. En Supabase → **Authentication → Sign In / Providers → Google**: activalo y
   pegá el Client ID y el Client Secret.
3. En **Authentication → URL Configuration**: Site URL = tu URL de Vercel, y
   en Redirect URLs agregá `https://TU-APP.vercel.app/**` (y
   `http://localhost:3000/**` para dev).

**¿Quién puede entrar?** Solo `matiarona@gmail.com` y `vickyswag02@gmail.com`.
Está bloqueado en tres capas: el trigger de la base rechaza el alta de
cualquier otro mail, y el callback y el middleware cierran la sesión de
cualquier cuenta que no sea una de esas dos (la lista vive en `lib/auth.ts`).

**¿Cada cuánto pide login?** Casi nunca: la sesión se refresca sola en cada
visita. Para que sea así, en Supabase → Authentication → Sessions dejá
*time-box* e *inactivity timeout* desactivados (es el default). Si instalan
la PWA, queda como una app con sesión persistente.

## Cargar gastos sin abrir la app

Todas las vías terminan en el mismo lugar y entienden el mismo texto libre:

> `12500 súper` · `luz 45000` (lo marca como fijo) · `personal 8000 gym` ·
> `vicky 9000 farmacia` (lo pagó Vicky) · `1.234,56 ferretería`

### Bot de WhatsApp (recomendado)

Le escribís al número del bot y te contesta "Anotado ✓ …". Setup (una vez,
~20 min):

1. En [Meta for Developers](https://developers.facebook.com/): **Create App →
   Business** → agregá el producto **WhatsApp**. Te da un número de prueba y
   un token; para uso permanente generá un **token de sistema** (Business
   Settings → System users) y registrá un número propio si quieren.
2. En Vercel cargá `WHATSAPP_VERIFY_TOKEN` (lo inventás), `WHATSAPP_TOKEN`,
   `WHATSAPP_PHONE_ID` (está en WhatsApp → API Setup) y `WHATSAPP_APP_SECRET`
   (App Settings → Basic). Redeploy.
3. En WhatsApp → **Configuration → Webhook**: Callback URL
   `https://TU-APP.vercel.app/api/whatsapp`, Verify token el mismo que
   inventaste → Verify and save → suscribite al campo **messages**.
4. Cargá sus números en la base (el bot te dice tu número exacto si le
   escribís antes de este paso):
   ```sql
   update profiles set telefono = '549...' where nombre = 'Mati';
   update profiles set telefono = '549...' where nombre = 'Vicky';
   ```
5. Agenden el número del bot y listo: `12500 súper` → "Anotado ✓".

> Nota: en el número de prueba de Meta hay que registrar los teléfonos de
> ambos como destinatarios permitidos (API Setup → To). Con un número propio
> no hace falta.

### Google Forms (cero infraestructura)

1. Creá un Form con estos campos (títulos exactos): **Monto** (respuesta
   corta), **Descripción** (corta), **Quién pagó** (opción múltiple:
   Mati / Vicky), **Categoría** (opción múltiple, opcional: súper, salidas,
   transporte, delivery, regalos, servicios, hogar, otros), **¿Personal?**
   (opción múltiple: No / Sí).
2. En el Form: ⋮ → **Apps Script**, pegá esto (con tu URL y tu token):

   ```js
   const URL = 'https://TU-APP.vercel.app/api/ingesta'
   const TOKEN = 'el-mismo-INGESTA_TOKEN-de-vercel'

   function alEnviar(e) {
     const r = {}
     e.response.getItemResponses().forEach(ir => r[ir.getItem().getTitle()] = ir.getResponse())
     UrlFetchApp.fetch(URL, {
       method: 'post',
       contentType: 'application/json',
       payload: JSON.stringify({
         token: TOKEN,
         monto: r['Monto'],
         descripcion: r['Descripción'],
         quien: r['Quién pagó'],
         categoria: r['Categoría'] || null,
         personal: r['¿Personal?'] === 'Sí',
       }),
     })
   }
   ```
3. En Apps Script: ⏰ Triggers → Add trigger → función `alEnviar`, evento
   **On form submit**. Autorizá y listo.
4. Guardá el form como acceso directo en la pantalla de inicio del celu.

### Atajo del celu (iPhone/Android)

Un atajo que pregunta "¿Qué gastaste?" y hace POST a
`https://TU-APP.vercel.app/api/ingesta` con JSON
`{"token":"...","texto":"lo que escribiste","quien":"Mati"}` (en iOS:
Atajos → + → Pedir entrada → Obtener contenido de URL, método POST). Queda a
un tap o por Siri.

### Compartir a la app (Android)

Con la PWA instalada, desde cualquier app: Compartir → **Gastos** → se abre
la carga con el texto ya parseado (monto, categoría, etc.). En iOS Apple no
soporta share target de PWAs; usá el atajo.

## Deploy en Vercel

1. Push al repo y conectalo a Vercel.
2. Environment Variables: las de `.env.example` (mínimo las dos de Supabase;
   `SUPABASE_SERVICE_ROLE_KEY` + `INGESTA_TOKEN` para Forms/atajos; las
   `WHATSAPP_*` si usan el bot).
3. Redeploy y agregá la URL a los Redirect URLs de Supabase.

## Decisiones de diseño (para que las revises)

- **Personales con `prop_pagador = 1` forzado por un check** en la base:
  aunque una query se olvide de filtrarlos, no pueden mover el saldo.
- **Privacidad por RLS, no por UI**: las policies de `movimientos` esconden
  los personales del otro a nivel base de datos.
- **Allowlist en tres capas** (trigger + callback + middleware): el registro
  puede quedar "abierto" en Supabase que igual nadie más entra.
- **Historial fusionado en Resumen**: misma lista con filtros y borrar, pero
  con el contexto del mes (por persona, categorías, deudas) arriba.
- **`/api/*` autenticadas por token propio** (no por sesión): el middleware
  las excluye y cada una valida lo suyo (`INGESTA_TOKEN`, firma de Meta).
- **Tachar en vez de registrar transferencias**: saldar un mes no crea
  movimientos; agrega una fila en `meses_saldados` (con el monto como
  referencia y deshacer). Si después de tachar se carga o borra algo de ese
  mes, el Resumen lo avisa. Los viejos "pagos de saldo" (categoría `ajuste`)
  se siguen contemplando en el neto de su mes. Deudas a terceros no entran
  al saldo: se tachan cuota a cuota en `/deudas`.
- **Degradación con gracia**: si la migración v2 no se corrió, la app avisa
  con un cartel y lo básico (cargar y dividir gastos compartidos) sigue
  funcionando.
- **Reglas de división en el catálogo, no en el código**: `gastos_fijos`
  define cómo se divide cada servicio (`prop_pagador = 0.5`) y cuáles paga
  un tercero (`paga_tercero = 'Seba'` → se anota como deuda por
  `prop_tercero` del total). Cambiar una regla es un UPDATE, sin deploy.
- **Gráficos sin librerías**: la evolución y las barras por categoría son
  CSS puro — cero dependencias nuevas.
- Formato de plata `es-AR` sin decimales en pantalla; los centavos viven en
  la DB. Fechas de ingesta externa en hora argentina.

## Estructura

```
app/
  page.tsx            dashboard (saldo, mes, personal, últimos)
  resumen/page.tsx    resumen mensual por persona + categorías + deudas + lista
  personal/page.tsx   sección privada de gastos personales
  nuevo/page.tsx      carga (compartido/personal, share target)
  deudas/page.tsx     cuotas
  historial/page.tsx  redirect a /resumen
  login/page.tsx      Google + magic link
  auth/callback/      canje de código, allowlist y perfil automático
  api/ingesta/        POST con token: Forms, atajos, etc.
  api/whatsapp/       webhook Meta Cloud API (texto libre + confirmación)
components/           Nav, TacharMes, LogoutButton, PerfilSetup, SwRegister
lib/
  auth.ts             cuentas habilitadas (allowlist + perfil por mail)
  parsear-gasto.ts    parser de texto libre ("12500 súper")
  ingesta.ts          registro de gastos desde afuera (resuelve quién pagó)
  supabase/           clientes browser/server/admin
  format.ts           plata, fechas, balance
middleware.ts         protección de rutas + allowlist + refresh de sesión
docs/                 supabase_schema.sql (v1) + migracion_v2.sql
```
