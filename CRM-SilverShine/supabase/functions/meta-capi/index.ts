/* ═══════════════════════════════════════════════════════════════════
   meta-capi — Edge Function (Deno) del CRM SilverShine.
   Recibe los webhooks de la base de datos (triggers en `leads` y
   `facturas`) y manda a Meta Conversions API los eventos Lead y
   Purchase con el ctwa_clid del clic original del anuncio.

   Secretos (supabase secrets set …; NUNCA en el repo ni en el frontend):
     META_DATASET_ID      id del dataset (pixel) conectado al WABA
     META_ACCESS_TOKEN    token de usuario de sistema (ads_management)
     META_WABA_ID         id de la cuenta de WhatsApp Business (obligatorio
                          en user_data para action_source=business_messaging)
     META_GRAPH_VERSION   opcional, por defecto v25.0
     META_TEST_EVENT_CODE opcional: código de "Probar eventos" de Events
                          Manager; los eventos salen marcados como prueba
     CAPI_WEBHOOK_SECRET  el mismo secreto guardado en Vault (SQL)
   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY los pone
   Supabase solo.

   Desplegar con verificación de JWT APAGADA (los triggers no mandan JWT):
     supabase functions deploy meta-capi --no-verify-jwt
   La función verifica ella misma: o el Bearer es el secreto del webhook,
   o es el JWT de un usuario del CRM (para "Probar conexión" y reintentos).
   ═══════════════════════════════════════════════════════════════════ */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const WEBHOOK_SECRET = Deno.env.get("CAPI_WEBHOOK_SECRET") ?? "";
const META_DATASET_ID = Deno.env.get("META_DATASET_ID") ?? "";
const META_ACCESS_TOKEN = Deno.env.get("META_ACCESS_TOKEN") ?? "";
const META_WABA_ID = Deno.env.get("META_WABA_ID") ?? "";
const META_GRAPH_VERSION = Deno.env.get("META_GRAPH_VERSION") || "v25.0";
const META_TEST_EVENT_CODE = Deno.env.get("META_TEST_EVENT_CODE") ?? "";
const PARTNER_AGENT = "silvershine-crm";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Lead = {
  id: string;
  telefono: string | null;
  nombre: string | null;
  origen: string | null;
  ctwa_clid: string | null;
  calificado: boolean;
  cliente_id: string | null;
  factura_id: string | null;
  evento_lead_enviado_at: string | null;
  evento_compra_enviado_at: string | null;
  capi_ultimo_error: string | null;
};
type FacturaRow = { id: string; data: Record<string, unknown>; lead_id?: string | null };
type Resultado = { ok: boolean; accion: string; detalle?: unknown };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

/* ── PostgREST con la service role (salta RLS) ── */
async function db(metodo: string, ruta: string, body?: unknown, prefer?: string) {
  const headers: Record<string, string> = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
  };
  if (prefer) headers.Prefer = prefer;
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${ruta}`, {
    method: metodo,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const txt = await resp.text();
  if (!resp.ok) throw new Error(`Supabase ${resp.status}: ${txt.slice(0, 200)}`);
  return txt ? JSON.parse(txt) : null;
}

const leadPorId = async (id: string): Promise<Lead | null> =>
  ((await db("GET", `leads?id=eq.${encodeURIComponent(id)}&select=*&limit=1`)) as Lead[])[0] ?? null;

const facturaPorId = async (id: string): Promise<FacturaRow | null> =>
  ((await db("GET", `facturas?id=eq.${encodeURIComponent(id)}&select=id,data&limit=1`)) as FacturaRow[])[0] ?? null;

async function actualizarLead(id: string, cambios: Record<string, unknown>) {
  await db("PATCH", `leads?id=eq.${encodeURIComponent(id)}`, cambios, "return=minimal");
}

/* Bitácora: una fila por event_id; los reintentos actualizan la misma */
async function registrar(ev: {
  event_id: string; event_name: string; lead_id: string | null; factura_id?: string | null;
  valor?: number | null; moneda?: string | null; ok: boolean; respuesta?: unknown; error?: string | null;
}) {
  const previo = (await db("GET", `capi_eventos?event_id=eq.${encodeURIComponent(ev.event_id)}&select=intentos&limit=1`)) as { intentos: number }[];
  await db("POST", "capi_eventos?on_conflict=event_id", [{
    event_id: ev.event_id, event_name: ev.event_name, lead_id: ev.lead_id,
    factura_id: ev.factura_id ?? null, valor: ev.valor ?? null, moneda: ev.moneda ?? null,
    ok: ev.ok, respuesta: ev.respuesta ?? null, error: ev.error ?? null,
    intentos: (previo[0]?.intentos ?? 0) + 1, created_at: new Date().toISOString(),
  }], "resolution=merge-duplicates,return=minimal");
}

async function yaEnviado(eventId: string): Promise<boolean> {
  const filas = (await db("GET", `capi_eventos?event_id=eq.${encodeURIComponent(eventId)}&ok=is.true&select=id&limit=1`)) as unknown[];
  return filas.length > 0;
}

/* ── Utilidades Meta ── */
async function sha256(texto: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function userData(lead: Lead) {
  const ud: Record<string, unknown> = { ctwa_clid: lead.ctwa_clid };
  if (META_WABA_ID) ud.whatsapp_business_account_id = META_WABA_ID;
  const digitos = (lead.telefono ?? "").replace(/\D/g, "");
  if (digitos) ud.ph = [await sha256(digitos)];
  return ud;
}

function faltaConfig(): string | null {
  if (!META_DATASET_ID) return "Falta META_DATASET_ID";
  if (!META_ACCESS_TOKEN) return "Falta META_ACCESS_TOKEN";
  if (!META_WABA_ID) return "Falta META_WABA_ID";
  return null;
}

async function enviarMeta(evento: Record<string, unknown>) {
  const body: Record<string, unknown> = {
    data: [evento],
    partner_agent: PARTNER_AGENT,
    access_token: META_ACCESS_TOKEN,
  };
  if (META_TEST_EVENT_CODE) body.test_event_code = META_TEST_EVENT_CODE;
  const resp = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${META_DATASET_ID}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || data.error) {
    const e = data.error ?? {};
    throw new Error(`Meta ${resp.status}: ${e.message ?? "error"}${e.error_user_msg ? " — " + e.error_user_msg : ""}${e.fbtrace_id ? " (fbtrace " + e.fbtrace_id + ")" : ""}`);
  }
  return data; // { events_received, fbtrace_id, messages }
}

/* ── Evento Lead ── */
async function procesarLead(lead: Lead, forzar = false): Promise<Resultado> {
  const eventId = `${lead.id}-lead`;
  if (!lead.calificado) return { ok: true, accion: "omitido: lead no calificado" };
  if (lead.evento_lead_enviado_at && !forzar) return { ok: true, accion: "omitido: Lead ya reportado" };
  if (!lead.ctwa_clid) {
    await actualizarLead(lead.id, { capi_ultimo_error: "sin ctwa_clid" });
    await registrar({ event_id: eventId, event_name: "Lead", lead_id: lead.id, ok: false, error: "sin ctwa_clid" });
    return { ok: false, accion: "sin ctwa_clid: no se envía (Meta no lo atribuiría)" };
  }
  const falta = faltaConfig();
  if (falta) {
    await actualizarLead(lead.id, { capi_ultimo_error: falta });
    await registrar({ event_id: eventId, event_name: "Lead", lead_id: lead.id, ok: false, error: falta });
    return { ok: false, accion: falta };
  }
  const evento = {
    event_name: "Lead",
    event_time: Math.floor(Date.now() / 1000),
    event_id: eventId,
    action_source: "business_messaging",
    messaging_channel: "whatsapp",
    user_data: await userData(lead),
  };
  try {
    const resp = await enviarMeta(evento);
    console.log("Lead enviado", lead.id, resp);
    await actualizarLead(lead.id, { evento_lead_enviado_at: new Date().toISOString(), capi_ultimo_error: null });
    await registrar({ event_id: eventId, event_name: "Lead", lead_id: lead.id, ok: true, respuesta: resp });
    return { ok: true, accion: "Lead enviado", detalle: resp };
  } catch (e) {
    const msg = (e as Error).message;
    console.error("Lead falló", lead.id, msg);
    await actualizarLead(lead.id, { capi_ultimo_error: msg });
    await registrar({ event_id: eventId, event_name: "Lead", lead_id: lead.id, ok: false, error: msg });
    return { ok: false, accion: msg };
  }
}

/* ── Evento Purchase ── */
async function procesarFactura(fila: FacturaRow, forzar = false): Promise<Resultado> {
  const d = fila.data ?? {};
  const leadId = String(d.leadId ?? fila.lead_id ?? "");
  if (!leadId) return { ok: true, accion: "omitido: factura sin lead" };
  if (d.estado !== "pagada") return { ok: true, accion: `omitido: factura ${String(d.estado)}` };
  const eventId = `${fila.id}-purchase`;
  const lead = await leadPorId(leadId);
  if (!lead) {
    await registrar({ event_id: eventId, event_name: "Purchase", lead_id: null, factura_id: fila.id, ok: false, error: `lead ${leadId} no existe` });
    return { ok: false, accion: "el lead de la factura no existe" };
  }
  if (!forzar && await yaEnviado(eventId)) return { ok: true, accion: "omitido: Purchase ya reportado" };

  const valor = Math.round((Number(d.total) || 0) * 100) / 100;
  const moneda = d.moneda === "USD" ? "USD" : "DOP";
  if (!lead.ctwa_clid) {
    await actualizarLead(lead.id, { capi_ultimo_error: "sin ctwa_clid", factura_id: fila.id });
    await registrar({ event_id: eventId, event_name: "Purchase", lead_id: lead.id, factura_id: fila.id, valor, moneda, ok: false, error: "sin ctwa_clid" });
    return { ok: false, accion: "sin ctwa_clid: no se envía (Meta no lo atribuiría)" };
  }
  const falta = faltaConfig();
  if (falta) {
    await actualizarLead(lead.id, { capi_ultimo_error: falta, factura_id: fila.id });
    await registrar({ event_id: eventId, event_name: "Purchase", lead_id: lead.id, factura_id: fila.id, valor, moneda, ok: false, error: falta });
    return { ok: false, accion: falta };
  }
  const evento = {
    event_name: "Purchase",
    event_time: Math.floor(Date.now() / 1000),
    event_id: eventId,
    action_source: "business_messaging",
    messaging_channel: "whatsapp",
    user_data: await userData(lead),
    custom_data: { value: valor, currency: moneda },
  };
  try {
    const resp = await enviarMeta(evento);
    console.log("Purchase enviado", fila.id, valor, moneda, resp);
    await actualizarLead(lead.id, {
      factura_id: fila.id,
      capi_ultimo_error: null,
      ...(lead.evento_compra_enviado_at ? {} : { evento_compra_enviado_at: new Date().toISOString() }),
    });
    await registrar({ event_id: eventId, event_name: "Purchase", lead_id: lead.id, factura_id: fila.id, valor, moneda, ok: true, respuesta: resp });
    return { ok: true, accion: `Purchase enviado (${valor} ${moneda})`, detalle: resp };
  } catch (e) {
    const msg = (e as Error).message;
    console.error("Purchase falló", fila.id, msg);
    await actualizarLead(lead.id, { capi_ultimo_error: msg, factura_id: fila.id });
    await registrar({ event_id: eventId, event_name: "Purchase", lead_id: lead.id, factura_id: fila.id, valor, moneda, ok: false, error: msg });
    return { ok: false, accion: msg };
  }
}

/* ── PING: diagnóstico sin exponer secretos ── */
async function ping(): Promise<unknown> {
  const config = {
    dataset: !!META_DATASET_ID,
    token: !!META_ACCESS_TOKEN,
    waba: !!META_WABA_ID,
    webhook_secret: !!WEBHOOK_SECRET,
    version: META_GRAPH_VERSION,
    modo_prueba: META_TEST_EVENT_CODE || null,
  };
  let meta: unknown = null;
  if (META_DATASET_ID && META_ACCESS_TOKEN) {
    try {
      const r = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${META_DATASET_ID}?fields=id,name&access_token=${encodeURIComponent(META_ACCESS_TOKEN)}`);
      const d = await r.json().catch(() => ({}));
      meta = d.error ? { ok: false, error: d.error.message } : { ok: true, dataset: d.name ?? d.id };
    } catch (e) {
      meta = { ok: false, error: (e as Error).message };
    }
  }
  return { ok: true, config, meta };
}

/* ── Autenticación: secreto del webhook o JWT de un usuario del CRM ── */
async function usuarioValido(jwt: string): Promise<boolean> {
  if (!jwt || jwt.split(".").length !== 3) return false;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON_KEY, Authorization: `Bearer ${jwt}` } });
    if (!r.ok) return false;
    const u = await r.json();
    return !!u?.id && !String(u.email ?? "").startsWith("taller@");
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Solo POST" }, 405);

  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  let quien: "webhook" | "usuario" | null = null;
  if (WEBHOOK_SECRET && bearer === WEBHOOK_SECRET) quien = "webhook";
  else if (await usuarioValido(bearer)) quien = "usuario";
  if (!quien) return json({ error: "No autorizado" }, 401);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* sin cuerpo */ }

  try {
    /* Llamadas desde el CRM (usuario autenticado) */
    if (body.type === "PING") return json(await ping());
    if (body.type === "MANUAL") {
      if (quien !== "usuario") return json({ error: "Solo desde el CRM" }, 403);
      const forzar = body.forzar === true;
      if (body.event === "Lead" && typeof body.lead_id === "string") {
        const lead = await leadPorId(body.lead_id);
        if (!lead) return json({ ok: false, accion: "lead no encontrado" }, 404);
        return json(await procesarLead(lead, forzar));
      }
      if (body.event === "Purchase" && typeof body.factura_id === "string") {
        const fila = await facturaPorId(body.factura_id);
        if (!fila) return json({ ok: false, accion: "factura no encontrada" }, 404);
        return json(await procesarFactura(fila, forzar));
      }
      return json({ error: "MANUAL requiere event Lead+lead_id o Purchase+factura_id" }, 400);
    }

    /* Webhooks de la base de datos */
    const record = body.record as Record<string, unknown> | undefined;
    if (!record) return json({ error: "Sin record" }, 400);
    if (body.table === "leads") return json(await procesarLead(record as unknown as Lead));
    if (body.table === "facturas") return json(await procesarFactura(record as unknown as FacturaRow));
    return json({ ok: true, accion: `tabla ${String(body.table)} ignorada` });
  } catch (e) {
    console.error("meta-capi error", (e as Error).message);
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
