-- =====================================================================
-- MIGRACIÓN V2 — Login con Google, gastos personales y carga externa
-- Pegar TODO en: Supabase > SQL Editor > New query > Run
-- Es idempotente: se puede correr más de una vez sin romper nada.
-- Correr ANTES de deployar la versión nueva de la app.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. GASTOS PERSONALES
-- Nueva columna en movimientos. Un gasto personal no se divide
-- (prop_pagador = 1, lo fuerza el check de abajo) y solo lo ve su dueño
-- (lo fuerzan las policies del punto 3).
-- ---------------------------------------------------------------------
alter table public.movimientos
  add column if not exists es_personal boolean not null default false;

create index if not exists idx_movimientos_personal
  on public.movimientos (es_personal);

-- un personal siempre es 100% del pagador: así ni el balance de la app
-- ni balance_view pueden verse afectados aunque algo se filtre mal
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'chk_personal_prop') then
    alter table public.movimientos
      add constraint chk_personal_prop
      check (es_personal = false or prop_pagador = 1);
  end if;
end $$;

comment on column public.movimientos.es_personal is
  'true = gasto privado del pagador: no se divide, no entra al saldo y el otro no lo ve (RLS).';


-- ---------------------------------------------------------------------
-- 2. TELÉFONO EN PROFILES (para el bot de WhatsApp)
-- El webhook matchea el remitente contra esta columna. Formato: solo
-- dígitos como los manda WhatsApp (ej: 5491122334455). Si no usan el
-- bot, se puede dejar en null.
-- ---------------------------------------------------------------------
alter table public.profiles
  add column if not exists telefono text;

-- Completar cuando configuren el bot (el número exacto te lo dice el
-- propio bot si le escribís y no te reconoce):
-- update public.profiles set telefono = '549XXXXXXXXXX' where nombre = 'Mati';
-- update public.profiles set telefono = '549XXXXXXXXXX' where nombre = 'Vicky';


-- ---------------------------------------------------------------------
-- 3. RLS: PRIVACIDAD DE LOS PERSONALES
-- Antes: cualquier autenticado leía/escribía todo. Ahora, en movimientos,
-- lo compartido sigue abierto entre los dos pero lo personal solo lo ve
-- (y toca) su dueño. Las demás tablas quedan como estaban.
-- ---------------------------------------------------------------------
drop policy if exists "auth_all_select" on public.movimientos;
drop policy if exists "auth_all_insert" on public.movimientos;
drop policy if exists "auth_all_update" on public.movimientos;
drop policy if exists "auth_all_delete" on public.movimientos;
drop policy if exists "mov_select" on public.movimientos;
drop policy if exists "mov_insert" on public.movimientos;
drop policy if exists "mov_update" on public.movimientos;
drop policy if exists "mov_delete" on public.movimientos;

create policy "mov_select" on public.movimientos for select to authenticated
  using (es_personal = false or pagado_por = auth.uid());

create policy "mov_insert" on public.movimientos for insert to authenticated
  with check (es_personal = false or pagado_por = auth.uid());

create policy "mov_update" on public.movimientos for update to authenticated
  using (es_personal = false or pagado_por = auth.uid())
  with check (es_personal = false or pagado_por = auth.uid());

create policy "mov_delete" on public.movimientos for delete to authenticated
  using (es_personal = false or pagado_por = auth.uid());


-- ---------------------------------------------------------------------
-- 4. SOLO LAS DOS CUENTAS PUEDEN EXISTIR + PERFIL AUTOMÁTICO
-- El trigger de alta de usuario ahora:
--   - crea el perfil ya correcto según el mail (sin pantalla "¿Quién sos?")
--   - rechaza cualquier otro mail => nadie más puede registrarse, ni con
--     Google ni con magic link, aunque el registro esté abierto.
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if lower(new.email) = 'matiarona@gmail.com' then
    insert into public.profiles (id, nombre, porcentaje)
    values (new.id, 'Mati', 0.650)
    on conflict (id) do nothing;
  elsif lower(new.email) = 'vickyswag02@gmail.com' then
    insert into public.profiles (id, nombre, porcentaje)
    values (new.id, 'Vicky', 0.350)
    on conflict (id) do nothing;
  else
    raise exception 'Email no habilitado para esta libreta: %', new.email;
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Corregir los perfiles YA existentes según su mail (por si quedaron
-- como 'Nuevo' o con el porcentaje default):
update public.profiles p set nombre = 'Mati', porcentaje = 0.650
  from auth.users u where u.id = p.id and lower(u.email) = 'matiarona@gmail.com';

update public.profiles p set nombre = 'Vicky', porcentaje = 0.350
  from auth.users u where u.id = p.id and lower(u.email) = 'vickyswag02@gmail.com';

-- (Opcional) si alguna vez entró alguien más, se lo puede borrar desde
-- Authentication > Users en el dashboard; su perfil cae en cascada.


-- ---------------------------------------------------------------------
-- 5. MESES SALDADOS — el "tachado" de la división mensual
-- A principio de mes se mira cuánto dio el mes anterior, se transfiere
-- la diferencia, y se tacha acá. No se carga ningún movimiento: la fila
-- marca que ese mes ya está arreglado y guarda el monto de referencia.
-- ---------------------------------------------------------------------
create table if not exists public.meses_saldados (
  mes          text primary key check (mes ~ '^[0-9]{4}-[0-9]{2}$'),
  monto        numeric(12,2),
  saldado_por  uuid references public.profiles (id),
  created_at   timestamptz not null default now()
);

comment on table public.meses_saldados is
  'Un mes acá = la división de ese mes ya se transfirió ("tachado"). monto = cuánto se transfirió, como referencia.';

alter table public.meses_saldados enable row level security;

drop policy if exists "auth_all_select" on public.meses_saldados;
drop policy if exists "auth_all_insert" on public.meses_saldados;
drop policy if exists "auth_all_update" on public.meses_saldados;
drop policy if exists "auth_all_delete" on public.meses_saldados;
create policy "auth_all_select" on public.meses_saldados for select to authenticated using (true);
create policy "auth_all_insert" on public.meses_saldados for insert to authenticated with check (true);
create policy "auth_all_update" on public.meses_saldados for update to authenticated using (true) with check (true);
create policy "auth_all_delete" on public.meses_saldados for delete to authenticated using (true);

-- (Opcional) si los meses viejos ya estaban arreglados entre ustedes,
-- tachalos todos de una para arrancar limpio este mes:
-- insert into public.meses_saldados (mes)
--   select distinct to_char(fecha, 'YYYY-MM') from public.movimientos
--   where fecha < date_trunc('month', current_date)
-- on conflict do nothing;


-- ---------------------------------------------------------------------
-- 6. CÓMO SE DIVIDE CADA GASTO FIJO
-- Reglas reales de la casa:
--   - Luz, Gas, Internet, Agua y ABL: mitad y mitad con Vicky (50/50).
--   - Expensas: las paga Seba; al cargarlas no se crea un movimiento sino
--     una DEUDA con Seba por la mitad de quien las carga (se suma a las
--     otras deudas con Seba y se tacha en Cuotas cuando se le paga).
-- ---------------------------------------------------------------------
alter table public.gastos_fijos
  add column if not exists prop_pagador numeric(4,3)
    check (prop_pagador is null or (prop_pagador >= 0 and prop_pagador <= 1));

alter table public.gastos_fijos
  add column if not exists paga_tercero text;

alter table public.gastos_fijos
  add column if not exists prop_tercero numeric(4,3)
    check (prop_tercero is null or (prop_tercero >= 0 and prop_tercero <= 1));

comment on column public.gastos_fijos.prop_pagador is
  'Division del fijo al cargarlo: 0.5 = mitad y mitad. NULL = porcentaje del perfil del pagador.';
comment on column public.gastos_fijos.paga_tercero is
  'Si lo paga un tercero (ej Seba): cargarlo crea una deuda con el por prop_tercero (default 0.5) del total, en vez de un movimiento.';

update public.gastos_fijos set prop_pagador = 0.5
  where lower(nombre) in ('luz', 'gas', 'internet', 'agua', 'abl');

update public.gastos_fijos set paga_tercero = 'Seba', prop_tercero = 0.5
  where lower(nombre) = 'expensas';

-- (Opcional) si los servicios YA cargados también eran mitad y mitad de
-- verdad, corregí los que quedaron divididos 65/35. Ojo: cambia el neto
-- de los meses sin tachar (los tachados van a mostrar un aviso).
-- update public.movimientos set prop_pagador = 0.5
--   where tipo = 'gasto_fijo' and prop_pagador is null;

-- (Opcional) los gastos viejos marcados "100% de quien lo pagó" ahora son
-- personales (la carga nueva los manda directo a la sección Personal):
-- update public.movimientos set es_personal = true
--   where prop_pagador = 1 and es_personal = false;


-- ---------------------------------------------------------------------
-- 7. PRESUPUESTOS POR CATEGORÍA (opcionales)
-- Límite mensual por categoría de lo compartido. La barra del Resumen
-- se pone en ámbar al pasar el 80% y en rojo al pasarse del límite.
-- Se cargan desde la app (lápiz en "Por categoría") o por SQL.
-- ---------------------------------------------------------------------
create table if not exists public.presupuestos (
  categoria   text primary key,
  monto       numeric(12,2) not null check (monto > 0),
  created_at  timestamptz not null default now()
);

alter table public.presupuestos enable row level security;

drop policy if exists "auth_all_select" on public.presupuestos;
drop policy if exists "auth_all_insert" on public.presupuestos;
drop policy if exists "auth_all_update" on public.presupuestos;
drop policy if exists "auth_all_delete" on public.presupuestos;
create policy "auth_all_select" on public.presupuestos for select to authenticated using (true);
create policy "auth_all_insert" on public.presupuestos for insert to authenticated with check (true);
create policy "auth_all_update" on public.presupuestos for update to authenticated using (true) with check (true);
create policy "auth_all_delete" on public.presupuestos for delete to authenticated using (true);


-- ---------------------------------------------------------------------
-- 8. TIEMPO REAL + NOTIFICACIONES PUSH
-- a) Realtime: lo que carga uno aparece al instante en el celu del otro.
--    (postgres_changes respeta RLS: los personales del otro no viajan.)
-- b) push_subs: suscripciones de notificaciones push de cada dispositivo.
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['movimientos', 'deudas', 'meses_saldados'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

create table if not exists public.push_subs (
  endpoint      text primary key,
  profile_id    uuid not null references public.profiles (id) on delete cascade,
  subscription  jsonb not null,
  created_at    timestamptz not null default now()
);

comment on table public.push_subs is
  'Suscripciones web push: una fila por dispositivo. El servidor (service role) las usa para mandar avisos.';

alter table public.push_subs enable row level security;

drop policy if exists "subs_propias_select" on public.push_subs;
drop policy if exists "subs_propias_insert" on public.push_subs;
drop policy if exists "subs_propias_update" on public.push_subs;
drop policy if exists "subs_propias_delete" on public.push_subs;
create policy "subs_propias_select" on public.push_subs for select to authenticated
  using (profile_id = auth.uid());
create policy "subs_propias_insert" on public.push_subs for insert to authenticated
  with check (profile_id = auth.uid());
create policy "subs_propias_update" on public.push_subs for update to authenticated
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());
create policy "subs_propias_delete" on public.push_subs for delete to authenticated
  using (profile_id = auth.uid());


-- =====================================================================
-- FIN. Después de correr esto:
--   1. Verificá: select nombre, porcentaje, telefono from profiles;
--   2. Verificá: select * from meses_saldados; (vacía, pero existe)
--   3. Habilitá Google como provider (ver README, sección "Login con Google").
--   4. Deployá la app nueva con las env vars nuevas (VAPID incluidas).
-- =====================================================================
