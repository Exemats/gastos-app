-- =====================================================================
-- APP DE GASTOS COMPARTIDOS — Esquema Supabase (Fase 2)
-- Mati & Vicky | División depto 65/35
-- Pegar TODO en: Supabase > SQL Editor > New query > Run
-- Es idempotente en lo posible (usa IF NOT EXISTS / CREATE OR REPLACE).
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0. EXTENSIONES
-- ---------------------------------------------------------------------
create extension if not exists "pgcrypto";  -- para gen_random_uuid()


-- ---------------------------------------------------------------------
-- 1. PROFILES
-- Extiende auth.users (la tabla de usuarios que maneja Supabase Auth).
-- Cada uno de ustedes es una fila. 'porcentaje' = su parte del depto.
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  nombre      text not null,
  porcentaje  numeric(4,3) not null default 0.500
              check (porcentaje >= 0 and porcentaje <= 1),
  created_at  timestamptz not null default now()
);

comment on column public.profiles.porcentaje is
  'Parte que le toca de los gastos compartidos. Mati 0.650, Vicky 0.350. Deben sumar 1 entre los dos.';


-- ---------------------------------------------------------------------
-- 2. MOVIMIENTOS
-- Tabla central. Reemplaza TODAS las hojas "Gastos depto [mes]".
-- Cada fila es un gasto compartido (depto o fijo).
--
-- Diseño clave de la división:
--   - 'pagado_por'  = quién PUSO la plata.
--   - 'prop_pagador'= qué proporción del gasto le CORRESPONDE al pagador.
--        Default NULL -> la view usa el porcentaje del perfil del pagador.
--        Si algún gasto puntual NO es 65/35 (ej: un regalo que es 100% tuyo),
--        cargás un valor acá (ej 1.0) y se respeta. Flexibilidad sin fricción.
-- ---------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_type where typname = 'tipo_movimiento') then
    create type tipo_movimiento as enum ('gasto_depto', 'gasto_fijo');
  end if;
end $$;

create table if not exists public.movimientos (
  id            uuid primary key default gen_random_uuid(),
  tipo          tipo_movimiento not null default 'gasto_depto',
  fecha         date not null default current_date,
  descripcion   text not null,
  monto         numeric(12,2) not null check (monto >= 0),
  pagado_por    uuid not null references public.profiles (id),
  prop_pagador  numeric(4,3) check (prop_pagador >= 0 and prop_pagador <= 1),
  categoria     text,
  created_at    timestamptz not null default now()
);

create index if not exists idx_movimientos_fecha   on public.movimientos (fecha);
create index if not exists idx_movimientos_tipo     on public.movimientos (tipo);
create index if not exists idx_movimientos_pagador  on public.movimientos (pagado_por);

comment on column public.movimientos.prop_pagador is
  'Proporcion del gasto que le toca al que pago. NULL = usar profiles.porcentaje del pagador. 1.0 = el gasto es 100% del pagador (no genera deuda).';


-- ---------------------------------------------------------------------
-- 3. DEUDAS (cuotas con vida propia)
-- Hereda la lógica de la hoja "Vicky": con quién, cuántas cuotas,
-- monto total, cuántas van pagas, valor de cuota.
--
-- 'acreedor_tipo' distingue:
--   - 'externo'  -> se le debe a alguien de afuera (Seba, Papá, Natasha...).
--                   Guardás el nombre en 'acreedor_nombre'. NO entra al saldo
--                   neto entre ustedes (Decisión 1).
--   - 'interno'  -> se le debe al otro miembro de la pareja.
--                   Guardás su uuid en 'acreedor_profile'. Esto SÍ podría
--                   sumarse al saldo si lo querés (lo dejo separado por ahora).
-- ---------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_type where typname = 'tipo_acreedor') then
    create type tipo_acreedor as enum ('externo', 'interno');
  end if;
end $$;

create table if not exists public.deudas (
  id                   uuid primary key default gen_random_uuid(),
  descripcion          text not null,
  acreedor_tipo        tipo_acreedor not null default 'externo',
  acreedor_nombre      text,                                   -- si externo: 'Seba','Papá'...
  acreedor_profile     uuid references public.profiles (id),   -- si interno: el otro
  deudor               uuid not null references public.profiles (id),
  monto_total          numeric(12,2) not null check (monto_total >= 0),
  cantidad_cuotas      int not null check (cantidad_cuotas >= 1),
  cuota_actual         int not null default 0 check (cuota_actual >= 0),
  fecha_primera_cuota  date,
  activa               boolean not null default true,
  created_at           timestamptz not null default now(),

  -- coherencia: externo necesita nombre; interno necesita profile
  constraint chk_acreedor check (
    (acreedor_tipo = 'externo' and acreedor_nombre is not null) or
    (acreedor_tipo = 'interno' and acreedor_profile is not null)
  ),
  -- no podés haber pagado más cuotas de las que existen
  constraint chk_cuotas check (cuota_actual <= cantidad_cuotas)
);

create index if not exists idx_deudas_deudor on public.deudas (deudor);
create index if not exists idx_deudas_activa on public.deudas (activa);

-- valor_cuota y cuotas_restantes los calculamos como columnas GENERADAS,
-- así nunca quedan desincronizadas del total.
alter table public.deudas
  add column if not exists valor_cuota numeric(12,2)
    generated always as (round(monto_total / cantidad_cuotas, 2)) stored;

alter table public.deudas
  add column if not exists cuotas_restantes int
    generated always as (cantidad_cuotas - cuota_actual) stored;


-- ---------------------------------------------------------------------
-- 4. GASTOS_FIJOS (catálogo de recurrentes)
-- Para no recargar luz/gas/internet cada mes. Es un catálogo; cuando
-- pagás la factura del mes, creás un movimiento tipo 'gasto_fijo'.
-- ---------------------------------------------------------------------
create table if not exists public.gastos_fijos (
  id              uuid primary key default gen_random_uuid(),
  nombre          text not null,
  monto_estimado  numeric(12,2) check (monto_estimado >= 0),
  dia_vencimiento int check (dia_vencimiento between 1 and 31),
  activo          boolean not null default true,
  created_at      timestamptz not null default now()
);


-- =====================================================================
-- 5. LA VIEW DEL BALANCE  (el corazón: el saldo sale solo)
-- =====================================================================
-- Lógica, gasto por gasto compartido (gasto_depto + gasto_fijo):
--   prop = prop_pagador del movimiento, o si es NULL, el porcentaje
--          del perfil del pagador.
--   "le_corresponde_al_pagador" = monto * prop
--   "puso_de_mas" = monto - le_corresponde  (lo que pagó de la parte del otro)
--
-- Si Mati pagó y puso de más -> Vicky le debe esa diferencia.
-- Si Vicky pagó y puso de más -> Mati le debe esa diferencia.
--
-- balance = (lo que Mati puso de más) - (lo que Vicky puso de más)
--   balance > 0  -> Vicky le debe a Mati
--   balance < 0  -> Mati le debe a Vicky
-- ---------------------------------------------------------------------
create or replace view public.balance_view as
with calc as (
  select
    m.id,
    m.pagado_por,
    m.monto,
    coalesce(m.prop_pagador, p.porcentaje) as prop,
    m.monto - (m.monto * coalesce(m.prop_pagador, p.porcentaje)) as puso_de_mas
  from public.movimientos m
  join public.profiles p on p.id = m.pagado_por
)
select
  -- suma de lo que cada uno puso de más (de la parte del otro)
  coalesce(sum(case when c.pagado_por = (select id from public.profiles where nombre = 'Mati')
                    then c.puso_de_mas else 0 end), 0) as mati_puso_de_mas,
  coalesce(sum(case when c.pagado_por = (select id from public.profiles where nombre = 'Vicky')
                    then c.puso_de_mas else 0 end), 0) as vicky_puso_de_mas,
  -- balance neto: positivo = Vicky le debe a Mati
  coalesce(sum(case when c.pagado_por = (select id from public.profiles where nombre = 'Mati')
                    then c.puso_de_mas else 0 end), 0)
  - coalesce(sum(case when c.pagado_por = (select id from public.profiles where nombre = 'Vicky')
                      then c.puso_de_mas else 0 end), 0) as balance_neto
from calc c;

comment on view public.balance_view is
  'Saldo neto entre Mati y Vicky. balance_neto > 0: Vicky le debe a Mati. < 0: Mati le debe a Vicky.';


-- View auxiliar: total que el deudor le debe a cada acreedor externo,
-- sumando cuotas que faltan de todas las deudas activas.
create or replace view public.deudas_por_acreedor as
select
  coalesce(acreedor_nombre,
           (select nombre from public.profiles pr where pr.id = d.acreedor_profile)) as acreedor,
  d.acreedor_tipo,
  sum(d.valor_cuota * d.cuotas_restantes) as total_restante,
  count(*) as deudas_activas
from public.deudas d
where d.activa = true
group by 1, 2;


-- =====================================================================
-- 6. SEED DATA  (cargar UNA sola vez, después de crear los usuarios)
-- =====================================================================
-- IMPORTANTE: profiles.id debe coincidir con auth.users.id.
-- Por eso esto va DESPUÉS de la Fase 3 (Auth), cuando ya existan los
-- usuarios. Si querés probar la estructura YA sin auth, descomentá el
-- bloque de abajo que crea perfiles con uuids inventados, probá, y
-- luego borralos antes de conectar auth real.

-- --- catálogo de gastos fijos (esto sí podés cargar ya) ---
insert into public.gastos_fijos (nombre, activo) values
  ('Luz', true),
  ('Gas', true),
  ('Internet', true),
  ('Agua', true),
  ('ABL', true),
  ('Expensas', true)
on conflict do nothing;

-- --- perfiles de prueba (SOLO para testear estructura sin auth) ---
-- DESCOMENTAR para probar, BORRAR antes de Fase 3:
-- insert into public.profiles (id, nombre, porcentaje) values
--   (gen_random_uuid(), 'Mati', 0.650),
--   (gen_random_uuid(), 'Vicky', 0.350);


-- =====================================================================
-- 7. ROW LEVEL SECURITY (RLS)
-- App de 2 personas con confianza mutua: cualquier usuario autenticado
-- puede leer y escribir todo. (No hace falta granularidad por usuario.)
-- =====================================================================
alter table public.profiles     enable row level security;
alter table public.movimientos  enable row level security;
alter table public.deudas       enable row level security;
alter table public.gastos_fijos enable row level security;

-- Policies: authenticated puede todo. (DROP primero para idempotencia.)
do $$
declare t text;
begin
  foreach t in array array['profiles','movimientos','deudas','gastos_fijos'] loop
    execute format('drop policy if exists "auth_all_select" on public.%I', t);
    execute format('drop policy if exists "auth_all_insert" on public.%I', t);
    execute format('drop policy if exists "auth_all_update" on public.%I', t);
    execute format('drop policy if exists "auth_all_delete" on public.%I', t);

    execute format('create policy "auth_all_select" on public.%I for select to authenticated using (true)', t);
    execute format('create policy "auth_all_insert" on public.%I for insert to authenticated with check (true)', t);
    execute format('create policy "auth_all_update" on public.%I for update to authenticated using (true) with check (true)', t);
    execute format('create policy "auth_all_delete" on public.%I for delete to authenticated using (true)', t);
  end loop;
end $$;


-- =====================================================================
-- 8. TRIGGER: auto-crear profile al registrarse un usuario
-- Cuando alguien se da de alta en Auth, se crea su fila en profiles.
-- El nombre y porcentaje los ajustás a mano la primera vez (o desde la app).
-- =====================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, nombre, porcentaje)
  values (new.id, coalesce(new.raw_user_meta_data->>'nombre', 'Nuevo'), 0.500)
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- =====================================================================
-- FIN. Después de correr esto:
--   1. Verificá en Table Editor que existan las 4 tablas + 2 views.
--   2. (Fase 3) Creá los usuarios; corregí nombre/porcentaje en profiles.
--   3. Probá: insertá un movimiento y consultá  select * from balance_view;
-- =====================================================================
