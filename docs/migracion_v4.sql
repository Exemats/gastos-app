-- =====================================================================
-- MIGRACIÓN V4 — Unificar cómo se anota "esto se divide con un tercero"
-- Pegar TODO en: Supabase > SQL Editor > New query > Run
-- Es idempotente: se puede correr más de una vez sin romper nada.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. PRÉSTAMOS COMO CAMPO EXPLÍCITO, NO COMO categoria = 'ajuste'
-- Antes, un préstamo/devolución entre ustedes se distinguía por un
-- string mágico en categoria. Ahora es un campo propio: mismo dato,
-- pero visible y auditable sin tener que conocer la convención.
-- ---------------------------------------------------------------------
alter table public.movimientos
  add column if not exists es_prestamo boolean not null default false;

update public.movimientos set es_prestamo = true
  where categoria = 'ajuste' and not es_prestamo;

comment on column public.movimientos.es_prestamo is
  'true = plata directa entre ustedes (préstamo/devolución): cuenta 100% a favor de quien la puso, no es un gasto. Reemplaza la convención vieja categoria = ''ajuste'' (que se deja como está, por las dudas, pero el código ya no la usa).';


-- ---------------------------------------------------------------------
-- 2. VÍNCULOS ENTRE DEUDAS Y CON EL MOVIMIENTO QUE LAS GENERÓ
-- Dos patrones que antes vivían duplicados en distintos archivos ahora
-- comparten el mismo lugar (lib/dividir.ts) y necesitan poder guardar
-- el vínculo, para que se vea de dónde salió cada deuda:
--   - "gasto con un tercero" (ej Expensas → Seba): el movimiento del
--     gasto del depto + la deuda con el tercero por su parte.
--     movimiento_id apunta al movimiento que la generó.
--   - "cuota dividida entre ustedes": la deuda real (con el tercero, o
--     la que sea) + una segunda deuda interna por la parte del otro.
--     vinculo_id apunta a la otra mitad del par.
-- ---------------------------------------------------------------------
alter table public.deudas
  add column if not exists movimiento_id uuid references public.movimientos (id) on delete set null;

alter table public.deudas
  add column if not exists vinculo_id uuid references public.deudas (id) on delete set null;

comment on column public.deudas.movimiento_id is
  'Si esta deuda nació junto con un gasto del depto (ej: Expensas → Seba), el movimiento que la generó. NULL si es una deuda suelta.';
comment on column public.deudas.vinculo_id is
  'Si esta deuda se cargó "dividida" con la otra persona, el id de su par (la otra mitad). Cada una se edita/borra por separado; esto es solo para poder mostrarlas juntas.';


-- =====================================================================
-- FIN. Después de correr esto:
--   1. Verificá: select count(*) from movimientos where es_prestamo;
--      tendría que coincidir con los que antes tenían categoria='ajuste'.
--   2. Nada se borra ni se renombra: la app sigue andando igual si por
--      algún motivo esta migración no se corrió (usa el fallback viejo).
-- =====================================================================
