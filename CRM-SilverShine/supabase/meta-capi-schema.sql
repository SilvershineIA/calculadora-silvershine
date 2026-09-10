-- ═══════════════════════════════════════════════════════════════════
-- CRM SilverShine — Fase 2: Leads de WhatsApp ↔ Meta Conversions API
-- Pegar COMPLETO en: Supabase → SQL Editor → New query → Run
-- (mismo proyecto del CRM; es idempotente: se puede correr varias veces)
--
-- ⚠ ANTES de correr, reemplaza los DOS valores del bloque "Vault":
--    · la URL de la Edge Function (lleva el ref de TU proyecto)
--    · el secreto del webhook (una clave larga inventada por ti; la
--      misma que pondrás en `supabase secrets set CAPI_WEBHOOK_SECRET=…`)
-- ═══════════════════════════════════════════════════════════════════

create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault;

-- ── 0. Vault: dónde vive la función y con qué secreto se le habla ──
--      (la URL y el secreto NO quedan en el repo ni en el frontend)
do $$
declare
  v_url text := 'https://TU-PROYECTO.supabase.co/functions/v1/meta-capi';   -- ← REEMPLAZA
  v_secreto text := 'PEGA-AQUI-UN-SECRETO-LARGO-Y-ALEATORIO';               -- ← REEMPLAZA
begin
  if v_url like '%TU-PROYECTO%' or v_secreto like 'PEGA-AQUI%' then
    raise exception 'Edita la URL de la función y el secreto del webhook antes de correr este SQL';
  end if;
  delete from vault.secrets where name in ('capi_function_url', 'capi_webhook_secret');
  perform vault.create_secret(v_url, 'capi_function_url', 'URL de la Edge Function meta-capi');
  perform vault.create_secret(v_secreto, 'capi_webhook_secret', 'Bearer que los triggers mandan a meta-capi');
end $$;

-- ── 1. Teléfono E.164 (una sola regla para toda la casa) ──
--      RD: 809/829/849 + 7 dígitos → +1XXXXXXXXXX. Quita espacios, guiones,
--      paréntesis y el prefijo internacional 00. Misma lógica que
--      UI.normalizarTelefono() en el CRM.
create or replace function normalizar_telefono(t text) returns text
language plpgsql immutable as $$
declare d text;
begin
  if t is null then return null; end if;
  d := regexp_replace(t, '\D', '', 'g');
  if d = '' then return null; end if;
  d := regexp_replace(d, '^00', '');
  if length(d) = 10 then d := '1' || d; end if;   -- RD y resto de Norteamérica
  return '+' || d;
end $$;

-- ── 2. Tabla leads: lo que captura el agente de WhatsApp ──
create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  actualizado_at timestamptz not null default now(),
  telefono text not null,           -- E.164 (+1809…); el trigger lo normaliza
  nombre text,
  origen text,                      -- 'ad' | 'organico' | 'instagram' | 'web'
  ad_id text,                       -- referral.source_id
  ad_headline text,                 -- referral.headline
  ctwa_clid text,                   -- referral.ctwa_clid (clave para atribución)
  ocasion text,                     -- compromiso | trio | duo | aros | regalo | confeccion
  material text,                    -- plata | vermeil | oro
  calificado boolean not null default false,
  resumen text,                     -- síntesis del agente
  cliente_id text,                  -- id del cliente del CRM al vincular
  factura_id text,                  -- id de la factura del CRM cuando se factura
  evento_lead_enviado_at timestamptz,
  evento_compra_enviado_at timestamptz,
  capi_ultimo_error text,
  escalado boolean not null default false,   -- el agente pidió pasar con José
  escalado_at timestamptz
);
alter table leads add column if not exists escalado boolean not null default false;
alter table leads add column if not exists escalado_at timestamptz;
create index if not exists leads_telefono_idx on leads (telefono);
create index if not exists leads_ctwa_idx on leads (ctwa_clid);
create index if not exists leads_created_idx on leads (created_at desc);

create or replace function leads_antes_de_guardar() returns trigger
language plpgsql as $$
begin
  new.telefono := coalesce(normalizar_telefono(new.telefono), new.telefono);
  new.actualizado_at := now();
  return new;
end $$;
drop trigger if exists trg_leads_normalizar on leads;
create trigger trg_leads_normalizar before insert or update on leads
  for each row execute function leads_antes_de_guardar();

-- ── 3. Bitácora de eventos enviados a Meta (auditoría + idempotencia) ──
create table if not exists capi_eventos (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  event_id text not null unique,    -- '<lead>-lead' | '<factura>-purchase'
  event_name text not null,         -- Lead | Purchase
  lead_id uuid references leads(id) on delete set null,
  factura_id text,
  valor numeric,
  moneda text,
  ok boolean not null default false,
  intentos int not null default 1,
  respuesta jsonb,                  -- events_received, fbtrace_id…
  error text
);
create index if not exists capi_eventos_lead_idx on capi_eventos (lead_id);

-- ── 3b. Puente WhatsApp (Edge Function wa-webhook) ──
--      wa_chats: estado por teléfono — referral del anuncio, lead vinculado,
--      si el agente está en pausa porque José tomó el chat (coexistencia).
--      wa_eventos: bitácora de mensajes (in/out/echo/error) con dedupe por wamid.
create table if not exists wa_chats (
  telefono text primary key,          -- E.164
  nombre text,
  lead_id uuid references leads(id) on delete set null,
  ctwa_clid text,
  ad_id text,
  ad_headline text,
  ad_url text,
  ad_descripcion text,                -- lo que Claude vio en la imagen del anuncio
  referral_at timestamptz,
  agente_pausado boolean not null default false,
  pausado_hasta timestamptz,
  motivo_pausa text,
  vf_iniciado boolean not null default false,
  ultimo_mensaje_at timestamptz,
  ultimo_echo_at timestamptz,
  creado_at timestamptz not null default now(),
  actualizado_at timestamptz not null default now()
);
create table if not exists wa_eventos (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  wamid text unique,                  -- id del mensaje de WhatsApp (dedupe de reintentos)
  telefono text,
  tipo text not null,                 -- in | out | echo | error | pausa
  contenido text,
  detalle jsonb
);
create index if not exists wa_eventos_tel_idx on wa_eventos (telefono, created_at desc);
alter table wa_chats add column if not exists ad_descripcion text;

-- ── 4. Facturas: columna lead_id derivada del documento JSON ──
--      El CRM guarda `leadId` dentro de data; esta columna generada
--      permite filtrar y disparar el trigger sin tocar el sync.
alter table facturas add column if not exists lead_id text
  generated always as (data->>'leadId') stored;
create index if not exists facturas_lead_idx on facturas (lead_id) where lead_id is not null;

-- ── 5. Seguridad (RLS) ──
alter table leads enable row level security;
alter table capi_eventos enable row level security;

-- Voiceflow entra con la clave anon: SOLO puede insertar leads, leer el id
-- que le devuelve el insert (POST …/leads?select=id) y actualizar por id
-- unos pocos campos. Nunca lee teléfonos ni datos de clientes.
revoke all on leads from anon;
grant insert (telefono, nombre, origen, ad_id, ad_headline, ctwa_clid, ocasion, material, calificado, resumen) on leads to anon;
grant select (id) on leads to anon;
grant update (nombre, ocasion, material, calificado, resumen) on leads to anon;
revoke all on capi_eventos from anon;

drop policy if exists voiceflow_insert on leads;
create policy voiceflow_insert on leads for insert to anon with check (true);
drop policy if exists voiceflow_select_id on leads;
create policy voiceflow_select_id on leads for select to anon using (true);
drop policy if exists voiceflow_update on leads;
create policy voiceflow_update on leads for update to anon using (true) with check (true);

-- El CRM (usuario autenticado) lee y gestiona todo; el usuario del taller
-- (Tonglin) queda fuera, igual que en las demás tablas del CRM.
drop policy if exists crm_leads on leads;
create policy crm_leads on leads for all to authenticated
  using (coalesce(auth.jwt()->>'email', '') <> 'taller@silvershine.com.do')
  with check (coalesce(auth.jwt()->>'email', '') <> 'taller@silvershine.com.do');
drop policy if exists crm_capi_eventos on capi_eventos;
create policy crm_capi_eventos on capi_eventos for select to authenticated
  using (coalesce(auth.jwt()->>'email', '') <> 'taller@silvershine.com.do');

-- Puente WhatsApp: el CRM lee la bitácora y puede pausar/reactivar el agente
alter table wa_chats enable row level security;
alter table wa_eventos enable row level security;
revoke all on wa_chats from anon;
revoke all on wa_eventos from anon;
drop policy if exists crm_wa_chats on wa_chats;
create policy crm_wa_chats on wa_chats for all to authenticated
  using (coalesce(auth.jwt()->>'email', '') <> 'taller@silvershine.com.do')
  with check (coalesce(auth.jwt()->>'email', '') <> 'taller@silvershine.com.do');
drop policy if exists crm_wa_eventos on wa_eventos;
create policy crm_wa_eventos on wa_eventos for select to authenticated
  using (coalesce(auth.jwt()->>'email', '') <> 'taller@silvershine.com.do');
-- (las Edge Functions escriben con la service role, que salta RLS)

-- ── 6. Webhooks: la base de datos avisa a la Edge Function ──
--      Payload con la misma forma que los Database Webhooks de Supabase:
--      { type, table, schema, record, old_record }
create or replace function capi_notificar() returns trigger
language plpgsql security definer
set search_path = public, extensions, vault, net as $$
declare
  v_url text;
  v_secreto text;
  v_payload jsonb;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'capi_function_url' limit 1;
  select decrypted_secret into v_secreto from vault.decrypted_secrets where name = 'capi_webhook_secret' limit 1;
  if v_url is null or v_secreto is null then
    raise warning 'meta-capi: faltan capi_function_url / capi_webhook_secret en Vault';
    return new;
  end if;
  v_payload := jsonb_build_object(
    'type', tg_op, 'table', tg_table_name, 'schema', tg_table_schema,
    'record', to_jsonb(new),
    'old_record', case when tg_op = 'UPDATE' then to_jsonb(old) else null end);
  perform net.http_post(
    url := v_url,
    body := v_payload,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secreto),
    timeout_milliseconds := 8000);
  return new;
exception when others then
  raise warning 'meta-capi: no se pudo notificar (%): %', tg_table_name, sqlerrm;
  return new;
end $$;

-- 6a. Lead calificado → evento Lead. Dispara al insertar ya calificado o al
--     poner calificado=true; la función es idempotente (evento_lead_enviado_at).
drop trigger if exists trg_capi_lead on leads;
create trigger trg_capi_lead after insert or update of calificado on leads
  for each row
  when (new.calificado is true and new.evento_lead_enviado_at is null)
  execute function capi_notificar();

-- 6b. Factura pagada con lead → evento Purchase. Solo cuando CAMBIA a pagada
--     (o llega ya pagada), no en cada re-sincronización del documento.
drop trigger if exists trg_capi_compra_ins on facturas;
create trigger trg_capi_compra_ins after insert on facturas
  for each row
  when (new.data->>'estado' = 'pagada' and coalesce(new.data->>'leadId', '') <> '')
  execute function capi_notificar();

drop trigger if exists trg_capi_compra_upd on facturas;
create trigger trg_capi_compra_upd after update on facturas
  for each row
  when (new.data->>'estado' = 'pagada' and coalesce(new.data->>'leadId', '') <> ''
        and (old.data->>'estado' is distinct from new.data->>'estado'
             or old.data->>'leadId' is distinct from new.data->>'leadId'))
  execute function capi_notificar();
