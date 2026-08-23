-- ═══════════════════════════════════════════════════════════
-- Taller SilverShine ✕ Tonglin — esquema para Supabase
-- Pegar completo en: Supabase → SQL Editor → New query → Run
-- (usa el MISMO proyecto del CRM)
--
-- ⚠ ANTES de correr esto, edita la línea de abajo si usaste otro
--   correo para el usuario del taller (paso 2 de SETUP-TALLER.md):
-- ═══════════════════════════════════════════════════════════

-- El correo del usuario de Supabase que usará Tonglin (Karen).
-- Debe coincidir EXACTO con el que crees en Authentication → Users.
do $$ begin
  perform set_config('app.taller_email', 'taller@silvershine.com.do', false);
end $$;

-- ── 1. Tabla de la app del taller (documentos JSON, como el CRM) ──
create table if not exists taller (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_touch on taller;
create trigger trg_touch before update on taller
  for each row execute function touch_updated_at();

alter table taller enable row level security;
drop policy if exists taller_acceso on taller;
create policy taller_acceso on taller
  for all to authenticated using (true) with check (true);

-- ── 2. Bucket de archivos (fotos, PDFs, CADs, comprobantes) ──
insert into storage.buckets (id, name, public)
  values ('taller', 'taller', false)
  on conflict (id) do nothing;

drop policy if exists taller_storage on storage.objects;
create policy taller_storage on storage.objects
  for all to authenticated
  using (bucket_id = 'taller') with check (bucket_id = 'taller');

-- ── 3. Blindaje: el usuario del taller NO puede tocar las tablas
--      del CRM (clientes, facturas, finanzas…). Solo ve `taller`. ──
do $$
declare t text;
begin
  foreach t in array array['clientes','productos','facturas','pagos','cotizaciones','tareas','config','inventario'] loop
    execute format('drop policy if exists acceso_autenticado on %I', t);
    execute format(
      'create policy acceso_autenticado on %I for all to authenticated
         using (coalesce(auth.jwt()->>''email'', '''') <> ''taller@silvershine.com.do'')
         with check (coalesce(auth.jwt()->>''email'', '''') <> ''taller@silvershine.com.do'')', t);
  end loop;
end $$;
