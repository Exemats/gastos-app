-- =====================================================================
-- MIGRACIÓN V3 — Deudas con terceros (Seba) y "alguien me debe"
-- Pegar TODO en: Supabase > SQL Editor > New query > Run
-- Es idempotente: se puede correr más de una vez sin romper nada.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. QUIÉN DEBE (no solo a quién se debe)
-- Hasta ahora 'deudor' siempre era Mati o Vicky. Ahora también puede
-- deber un tercero (alguien externo que te debe a vos): mismo patrón
-- que 'acreedor_tipo'/'acreedor_nombre'/'acreedor_profile', pero del
-- lado del deudor.
--   - 'interno' -> debe Mati o Vicky (como antes): 'deudor' = su uuid.
--   - 'externo' -> debe alguien de afuera: 'deudor_nombre' tiene el
--     nombre y 'deudor' queda null.
-- ---------------------------------------------------------------------
alter table public.deudas
  add column if not exists deudor_tipo tipo_acreedor not null default 'interno';

alter table public.deudas
  add column if not exists deudor_nombre text;

alter table public.deudas
  alter column deudor drop not null;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'chk_deudor') then
    alter table public.deudas
      add constraint chk_deudor check (
        (deudor_tipo = 'interno' and deudor is not null) or
        (deudor_tipo = 'externo' and deudor_nombre is not null)
      );
  end if;
end $$;

comment on column public.deudas.deudor_tipo is
  'interno = debe Mati o Vicky (deudor = su uuid). externo = debe un tercero (deudor_nombre).';
comment on column public.deudas.deudor_nombre is
  'Si deudor_tipo = externo: nombre de quien te debe (para "alguien me debe").';


-- ---------------------------------------------------------------------
-- 2. EXPENSAS → SEBA: TAMBIÉN ES UN GASTO DEL DEPTO
-- Antes, cargar Expensas solo creaba la deuda con Seba (no un
-- movimiento): el gasto del depto no quedaba registrado. Ahora se crean
-- los dos: el movimiento (entra al saldo y a las estadísticas, igual que
-- cualquier otro servicio) y la deuda con Seba por la mitad del total.
--
-- 'tercero_deudor' fija quién queda debiéndole a Seba esa mitad,
-- siempre la misma persona sin importar quién carga el gasto ese mes
-- (en la práctica: Vicky no le paga nada a Seba, Mati siempre le debe
-- su mitad).
-- ---------------------------------------------------------------------
alter table public.gastos_fijos
  add column if not exists tercero_deudor uuid references public.profiles (id);

comment on column public.gastos_fijos.tercero_deudor is
  'Si paga_tercero está seteado: quién le queda debiendo la parte (prop_tercero) a ese tercero, sin importar quién cargue el gasto. NULL = quien carga.';

update public.gastos_fijos f set tercero_deudor = pr.id
  from public.profiles pr
  where lower(f.nombre) = 'expensas' and pr.nombre = 'Mati' and f.tercero_deudor is null;


-- =====================================================================
-- FIN. Después de correr esto:
--   1. Verificá: select nombre, paga_tercero, prop_tercero, tercero_deudor
--      from gastos_fijos where lower(nombre) = 'expensas';
--   2. Las deudas viejas quedan con deudor_tipo = 'interno' (no cambia
--      nada para ellas).
-- =====================================================================
