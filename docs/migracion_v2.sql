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


-- =====================================================================
-- FIN. Después de correr esto:
--   1. Verificá: select nombre, porcentaje, telefono from profiles;
--   2. Habilitá Google como provider (ver README, sección "Login con Google").
--   3. Deployá la app nueva con las env vars nuevas.
-- =====================================================================
