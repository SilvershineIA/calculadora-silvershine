-- ═══════════════════════════════════════════════════════════
-- CRM SilverShine — Esquema de base de datos para Supabase
-- Pegar completo en: Supabase → SQL Editor → New query → Run
-- ═══════════════════════════════════════════════════════════

create table if not exists clientes     (id text primary key, data jsonb not null, updated_at timestamptz not null default now());
create table if not exists productos    (id text primary key, data jsonb not null, updated_at timestamptz not null default now());
create table if not exists facturas     (id text primary key, data jsonb not null, updated_at timestamptz not null default now());
create table if not exists pagos        (id text primary key, data jsonb not null, updated_at timestamptz not null default now());
create table if not exists cotizaciones (id text primary key, data jsonb not null, updated_at timestamptz not null default now());
create table if not exists tareas       (id text primary key, data jsonb not null, updated_at timestamptz not null default now());
create table if not exists config       (id text primary key, data jsonb not null, updated_at timestamptz not null default now());
create table if not exists inventario   (id text primary key, data jsonb not null, updated_at timestamptz not null default now());

-- Mantener updated_at al día
create or replace function touch_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

do $$
declare t text;
begin
  foreach t in array array['clientes','productos','facturas','pagos','cotizaciones','tareas','config','inventario'] loop
    execute format('drop trigger if exists trg_touch on %I', t);
    execute format('create trigger trg_touch before update on %I for each row execute function touch_updated_at()', t);
  end loop;
end $$;

-- Seguridad: solo el usuario autenticado (tú) puede leer y escribir
do $$
declare t text;
begin
  foreach t in array array['clientes','productos','facturas','pagos','cotizaciones','tareas','config','inventario'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists acceso_autenticado on %I', t);
    execute format('create policy acceso_autenticado on %I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;
