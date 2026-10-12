# Brief para Claude Code — Fase 2: CRM SilverShine ↔ Meta Conversions API (WhatsApp)

## Contexto (léelo entero antes de tocar código)

**Negocio:** SilverShine, joyería fina (Santo Domingo). Vende por WhatsApp (829-956-6588). Embudo principal: Meta Ads (clic a WhatsApp) → chat → cotización/factura. Inversión en Meta Ads ~US$1,000/mes. Solo Jose atiende.

**Problema que se resuelve:** Meta optimiza los anuncios de clic a WhatsApp por "mensajes iniciados", no por ventas. Queremos devolverle a Meta los eventos **Lead (calificado)** y **Purchase** con el `ctwa_clid` del clic original, para que el algoritmo busque compradores y no curiosos. Es lo que hacen plataformas como Chatty (letschatty.com), que se descartó por precio (US$300+/mes). Lo hacemos sobre infraestructura propia.

**Lo que ya existe:**
- **CRM SilverShine** — app estática construida con Claude Code, publicada en GitHub Pages: `https://silvershineia.github.io/calculadora-silvershine/CRM-SilverShine/`. Módulos: Mi Día, Clientes, Catálogo, Calculadora, Facturas, Cotizaciones, Confecciones, Cobros, Finanzas, Cuadre, Inventario, Tareas, Ajustes. Ya tiene sección "Nube (Supabase)" y Jose dice que **ya está conectado a Supabase**. Verifica el estado real: qué tablas existen, si facturas/clientes ya sincronizan, o si sigue en localStorage con Supabase solo configurado.
- **Supabase** — proyecto activo (URL y anon key están en Ajustes del CRM).
- **Agente de WhatsApp** — se está montando en **Voiceflow + Claude** sobre WhatsApp Cloud API (Fase 1, en paralelo). El agente escribirá cada lead en Supabase. Documento del agente: `silvershine-agente-whatsapp.md` (prompt + base de conocimiento).
- La app estática guarda una clave de Anthropic en localStorage para "Foto a gasto". **Ese patrón NO sirve para el token de Meta** (ver seguridad).

## Objetivo de esta fase

1. Tabla `leads` en Supabase que recibe lo que el agente captura (incluido `ctwa_clid`).
2. El CRM muestra los leads y permite vincularlos a un cliente/cotización/factura.
3. Cuando el agente marca un lead como calificado → evento `Lead` a Meta.
4. Cuando una factura vinculada a un lead pasa a **pagada** → evento `Purchase` a Meta con monto y moneda.
5. Nada de esto depende de que el navegador esté abierto: corre en Supabase (Edge Functions + Database Webhooks).

## Arquitectura

```
Meta Ads (clic a WhatsApp)
   └─> WhatsApp Cloud API ──> Voiceflow (agente Claude)
                                  └─ API step ──> Supabase: insert en `leads` (con ctwa_clid)
                                                       │
                                     DB webhook (insert/update leads.calificado=true)
                                                       └─> Edge Function `meta-capi` ──> Meta CAPI: event Lead
CRM (GitHub Pages) ──> lee `leads`, vincula lead ↔ cliente ↔ factura
   └─ marca factura pagada ──> Supabase update `facturas`
                                     DB webhook (facturas.estado -> 'pagada' y lead_id no nulo)
                                                       └─> Edge Function `meta-capi` ──> Meta CAPI: event Purchase
```

## Tabla `leads` (crear si no existe)

```sql
create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  telefono text not null,           -- E.164 normalizado (+1809..., +1829..., +1849...)
  nombre text,
  origen text,                      -- 'ad' | 'organico' | 'instagram' | 'web'
  ad_id text,                       -- referral.source_id
  ad_headline text,                 -- referral.headline
  ctwa_clid text,                   -- referral.ctwa_clid (clave para atribución)
  ocasion text,                     -- compromiso | trio | duo | aros | regalo | confeccion
  material text,                    -- plata | vermeil | oro
  calificado boolean default false,
  resumen text,                     -- síntesis del agente
  cliente_id uuid,                  -- FK a clientes cuando se vincula
  factura_id text,                  -- id de factura del CRM cuando se factura
  evento_lead_enviado_at timestamptz,
  evento_compra_enviado_at timestamptz,
  capi_ultimo_error text
);
create index on leads (telefono);
create index on leads (ctwa_clid);

alter table leads enable row level security;
create policy "voiceflow_insert" on leads for insert with check (true);
-- lectura/actualización solo para usuario autenticado del CRM:
create policy "crm_read" on leads for select using (auth.role() = 'authenticated');
create policy "crm_update" on leads for update using (auth.role() = 'authenticated');
```

Revisa cómo está modelada `facturas` (o el equivalente) en Supabase y agrega `lead_id uuid references leads(id)` si no existe. Si las facturas siguen en localStorage, esta fase requiere primero que facturas y clientes vivan en Supabase; hazlo mínimo viable, no rediseñes el CRM.

## Edge Function `meta-capi`

Runtime Deno (Supabase Edge Functions). Secrets (via `supabase secrets set`, nunca en el repo ni en el frontend):
- `META_DATASET_ID` — id del dataset (pixel) vinculado al WABA en Events Manager.
- `META_ACCESS_TOKEN` — token de usuario de sistema con permiso `ads_management` (o el token que Events Manager genere para el dataset).
- `META_GRAPH_VERSION` — ej. `v23.0` (verificar la vigente).
- `META_WABA_ID` — opcional, para logging.

Payload a `POST https://graph.facebook.com/{version}/{dataset_id}/events`:

```json
{
  "data": [{
    "event_name": "Purchase",              // o "Lead"
    "event_time": 1725800000,              // unix seconds
    "action_source": "business_messaging", // OBLIGATORIO para WhatsApp
    "messaging_channel": "whatsapp",       // OBLIGATORIO para WhatsApp
    "event_id": "<leads.id>-purchase",     // dedupe idempotente
    "user_data": {
      "ctwa_clid": "<leads.ctwa_clid>",
      "ph": ["<sha256 del teléfono E.164 sin '+'>"]
    },
    "custom_data": {
      "value": 1531.00,
      "currency": "USD"                    // usar la moneda de la factura; si es DOP, mandar DOP
    }
  }],
  "partner_agent": "silvershine-crm"
}
```

Reglas:
- Si `ctwa_clid` es nulo, **no** envíes el evento (Meta lo acepta pero no lo atribuye; solo ensucia datos). Registra en `capi_ultimo_error` = "sin ctwa_clid".
- Idempotencia: usa `evento_*_enviado_at`; no reenviar si ya está.
- Guarda la respuesta de Meta (`events_received`, `fbtrace_id`) en logs; en error, en `capi_ultimo_error`.
- Los eventos deben enviarse dentro de los 7 días del clic para atribución completa; después igual se mandan.

## Database Webhooks (Supabase → Edge Function)

1. `leads` **UPDATE** cuando `calificado` pasa de false a true y `evento_lead_enviado_at is null` → `meta-capi` con `event_name: "Lead"`.
2. `facturas` **UPDATE** cuando `estado` pasa a `pagada` y `lead_id is not null` → `meta-capi` con `event_name: "Purchase"`, `value` = total de la factura, `currency` = moneda de la factura.

Usa un `Authorization: Bearer <secret>` propio en el webhook y verifícalo en la función para que nadie externo pueda disparar eventos.

## Cambios en el CRM (frontend)

Mínimo necesario, siguiendo el estilo y estructura actual del código:
- **Mi Día / Clientes**: sección "Leads de WhatsApp" que lista `leads` recientes (nombre, teléfono, origen, anuncio, ocasión, material, calificado, fecha). Botones: "Vincular a cliente" (busca por teléfono normalizado; crea el cliente si no existe) y "Cotizar".
- Al crear cotización o factura desde un lead, guardar `lead_id` en el registro.
- En Facturas, al marcar pagada, nada nuevo en la UI: el webhook hace el resto. Mostrar un indicador discreto "Reportado a Meta ✓" cuando `evento_compra_enviado_at` no sea nulo.
- Normalización de teléfono: función única `normalizarTelefono()` usada por leads, clientes y el matching (RD: 809/829/849 → `+1XXXXXXXXXX`; quitar espacios, guiones, paréntesis).
- **No** guardar ningún token de Meta en el frontend. La app es pública en GitHub Pages.

## Lado Voiceflow (para que sepas qué llega)

Paso API en Voiceflow tras la calificación: `POST {SUPABASE_URL}/rest/v1/leads` con headers `apikey: <anon>`, `Authorization: Bearer <anon>`, `Content-Type: application/json`, `Prefer: return=representation`, body con los campos de la tabla. Voiceflow no expone el `id` generado salvo que se pida con `return=representation`; guardarlo en una variable por si luego se actualiza `calificado`.

**Riesgo abierto:** no está confirmado que el conector de WhatsApp de Voiceflow exponga el objeto `referral` (`ctwa_clid`, `source_id`, `headline`). Se prueba en la sesión de Fase 1 con un mensaje real desde un anuncio. **Si no lo expone**, plan B: una Edge Function `wa-webhook` en este mismo Supabase que reciba el webhook de Meta, extraiga `messages[0].referral`, lo guarde en `leads` (o en una tabla `wa_referrals` por teléfono) y reenvíe el mensaje a Voiceflow vía Dialog Manager API. Deja el diseño preparado para eso pero no lo implementes hasta confirmar.

## Prerrequisitos que Jose debe hacer (no los puede hacer Claude)

- [ ] Verificación de empresa en Meta Business Manager (iniciada; puede tardar días).
- [ ] En Events Manager: crear/identificar el **dataset** y **conectarlo al WABA** (Configuración de WhatsApp → Conversions API).
- [ ] Generar token de usuario de sistema con acceso al dataset y pasarlo a `supabase secrets` (Claude Code guía, Jose pega).
- [ ] Confirmar qué tablas del CRM ya viven en Supabase.

## Criterio de "terminado"

1. Insertar un lead de prueba con `ctwa_clid` real → aparece en el CRM.
2. Marcarlo calificado → Events Manager muestra evento `Lead` con `action_source = business_messaging` y atribuido al anuncio.
3. Crear factura desde ese lead, marcar pagada → Events Manager muestra `Purchase` con el monto.
4. Un lead sin `ctwa_clid` no genera eventos y queda registrado el motivo.
5. Ningún token de Meta en el repo ni en el bundle público.

## Notas sueltas
- Hay inventario negativo en Shopify (ej. Alma Unida vermeil -13); no afecta esta fase.
- Contradicción en el sitio: portada dice 90 días para cambios, política dice 360. Pendiente de Jose, no de esta fase.
- Moneda del CRM: facturas en DOP mayormente; Shopify en USD. Enviar a Meta la moneda real de la factura, no convertir.
