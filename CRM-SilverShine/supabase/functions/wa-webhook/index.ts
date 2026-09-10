/* ═══════════════════════════════════════════════════════════════════
   wa-webhook — Puente WhatsApp Cloud API ↔ Voiceflow (Edge Function, Deno).

   Voiceflow no tiene canal nativo de WhatsApp: necesita un servidor que
   reciba los webhooks de Meta, le pase el mensaje al agente (Dialog Manager
   API) y devuelva la respuesta por la API de WhatsApp. Este es ese servidor,
   y de paso hace lo que la Fase 2 necesita:

     · Captura `referral.ctwa_clid` (clic al anuncio) y crea/actualiza el
       lead en `leads` ANTES de que el agente hable → atribución garantizada.
     · Le pasa al agente el lead_id, el titular del anuncio y el teléfono
       como variables, así el agente arranca sabiendo qué pieza vio el cliente.
     · Coexistencia: si José responde a mano desde su celular, Meta manda un
       "eco" (smb_message_echoes) → el agente se PAUSA 24 h en ese chat.
       José escribe "#bot" en el chat para reactivarlo, "#yo" para pausarlo.
     · Si el agente escala (variable `escalado` = true), marca el lead como
       escalado (aparece en Mi Día) y pausa el agente.

   Secretos (supabase secrets set …):
     WA_VERIFY_TOKEN     palabra que se pega en Meta → Webhook → Verify token
     WA_ACCESS_TOKEN     token permanente (usuario de sistema, whatsapp_business_messaging)
     WA_APP_SECRET       opcional: "App secret" de la app de Meta, para verificar la firma
     META_GRAPH_VERSION  opcional, por defecto v25.0
     VF_API_KEY          Voiceflow → Settings → API keys (Dialog Manager)
     VF_VERSION_ID       opcional: production (defecto) | development
     VF_DM_URL           opcional: https://general-runtime.voiceflow.com
     WA_PAUSA_HORAS      opcional: horas de pausa cuando José toma el chat (24)
     ANTHROPIC_API_KEY   para DESCRIBIR LAS FOTOS que mandan los clientes: el
                         agente de Voiceflow no ve imágenes, así que Claude
                         (visión) las convierte en texto — tipo de pieza, metal,
                         piedra, estilo y a qué diseño del catálogo se parece —
                         y eso es lo que recibe el agente. Sin la clave, el
                         agente solo sabe que "llegó una foto".

   Desplegar: supabase functions deploy wa-webhook --no-verify-jwt
   (Meta no manda JWT; la verificación es el verify token + la firma HMAC)
   ═══════════════════════════════════════════════════════════════════ */

import Anthropic from "npm:@anthropic-ai/sdk";
import { encodeBase64 } from "jsr:@std/encoding/base64";

const env = (k: string) => Deno.env.get(k) ?? "";
const ANTHROPIC_API_KEY = env("ANTHROPIC_API_KEY");
const SUPABASE_URL = env("SUPABASE_URL");
const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
const WA_VERIFY_TOKEN = env("WA_VERIFY_TOKEN") || "silvershine";
const WA_ACCESS_TOKEN = env("WA_ACCESS_TOKEN");
const WA_APP_SECRET = env("WA_APP_SECRET");
const GRAPH = env("META_GRAPH_VERSION") || "v25.0";
const VF_API_KEY = env("VF_API_KEY");
const VF_VERSION_ID = env("VF_VERSION_ID") || "production";
const VF_DM_URL = (env("VF_DM_URL") || "https://general-runtime.voiceflow.com").replace(/\/$/, "");
const PAUSA_MS = (Number(env("WA_PAUSA_HORAS")) || 24) * 3600 * 1000;

type Dict = Record<string, unknown>;
type Lead = { id: string; telefono: string; nombre: string | null; origen: string | null; ctwa_clid: string | null; escalado: boolean; factura_id: string | null; created_at: string };
type Chat = {
  telefono: string; nombre: string | null; lead_id: string | null; ctwa_clid: string | null;
  agente_pausado: boolean; pausado_hasta: string | null; vf_iniciado: boolean;
};

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

/* ── Supabase (service role) ── */
async function db(metodo: string, ruta: string, body?: unknown, prefer?: string) {
  const headers: Record<string, string> = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" };
  if (prefer) headers.Prefer = prefer;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${ruta}`, { method: metodo, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const txt = await r.text();
  if (!r.ok) throw new Error(`Supabase ${r.status} ${ruta}: ${txt.slice(0, 200)}`);
  return txt ? JSON.parse(txt) : null;
}
const q = encodeURIComponent;

async function registrar(ev: { wamid?: string; telefono?: string; tipo: string; contenido?: string; detalle?: unknown }) {
  try {
    await db("POST", "wa_eventos?on_conflict=wamid", [{ ...ev, wamid: ev.wamid ?? null, detalle: ev.detalle ?? null }], "resolution=ignore-duplicates,return=minimal");
  } catch (e) { console.warn("wa_eventos:", (e as Error).message); }
}
async function yaVisto(wamid: string): Promise<boolean> {
  const f = (await db("GET", `wa_eventos?wamid=eq.${q(wamid)}&select=id&limit=1`)) as unknown[];
  return f.length > 0;
}

/* ── Chats (estado por teléfono) ── */
async function chatDe(tel: string): Promise<Chat | null> {
  return ((await db("GET", `wa_chats?telefono=eq.${q(tel)}&select=*&limit=1`)) as Chat[])[0] ?? null;
}
async function guardarChat(tel: string, cambios: Dict): Promise<Chat> {
  const filas = (await db("POST", "wa_chats?on_conflict=telefono&select=*", [{ telefono: tel, ...cambios, actualizado_at: new Date().toISOString() }], "resolution=merge-duplicates,return=representation")) as Chat[];
  return filas[0];
}
const pausado = (c: Chat | null) => !!(c && c.agente_pausado && c.pausado_hasta && new Date(c.pausado_hasta).getTime() > Date.now());

/* ── Leads ── */
type Referral = {
  source_url?: string; source_id?: string; source_type?: string; headline?: string; body?: string;
  media_type?: string; image_url?: string; video_url?: string; thumbnail_url?: string; ctwa_clid?: string;
} | undefined;

async function asegurarLead(tel: string, nombre: string | null, ref: Referral): Promise<Lead> {
  // El lead "abierto" más reciente de este teléfono (últimos 30 días, sin factura)
  const desde = new Date(Date.now() - 30 * 864e5).toISOString();
  const abiertos = (await db("GET",
    `leads?telefono=eq.${q(tel)}&created_at=gte.${q(desde)}&factura_id=is.null&select=*&order=created_at.desc&limit=1`)) as Lead[];
  let lead = abiertos[0];
  const datosRef = ref?.ctwa_clid || ref?.source_id ? {
    origen: "ad", ctwa_clid: ref?.ctwa_clid ?? null, ad_id: ref?.source_id ?? null, ad_headline: ref?.headline ?? null,
  } : null;
  if (!lead) {
    const filas = (await db("POST", "leads?select=*", [{
      telefono: tel, nombre, origen: datosRef ? "ad" : "organico",
      ...(datosRef ?? {}),
    }], "return=representation")) as Lead[];
    lead = filas[0];
    console.log("lead creado", lead.id, tel, datosRef ? "desde anuncio" : "orgánico");
  } else {
    const cambios: Dict = {};
    if (nombre && !lead.nombre) cambios.nombre = nombre;
    if (datosRef && !lead.ctwa_clid) Object.assign(cambios, datosRef);   // llegó el clic después: se completa
    if (Object.keys(cambios).length) {
      await db("PATCH", `leads?id=eq.${q(lead.id)}`, cambios, "return=minimal");
      Object.assign(lead, cambios);
    }
  }
  return lead;
}

async function escalar(lead: Lead, tel: string, motivo: string) {
  await db("PATCH", `leads?id=eq.${q(lead.id)}`, { escalado: true, escalado_at: new Date().toISOString() }, "return=minimal");
  await guardarChat(tel, { agente_pausado: true, pausado_hasta: new Date(Date.now() + PAUSA_MS).toISOString(), motivo_pausa: motivo });
  await registrar({ telefono: tel, tipo: "pausa", contenido: motivo });
  console.log("escalado", tel, motivo);
}

/* ── WhatsApp Cloud API ── */
async function enviarWA(pnid: string, payload: Dict) {
  const r = await fetch(`https://graph.facebook.com/${GRAPH}/${pnid}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WA_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error(`WhatsApp ${r.status}: ${d.error?.message ?? "error"}${d.error?.error_data?.details ? " — " + d.error.error_data.details : ""}`);
  return d;
}
const texto = (to: string, body: string) => ({ to, type: "text", text: { body: body.slice(0, 4096), preview_url: true } });
const imagen = (to: string, link: string, caption?: string) => ({ to, type: "image", image: { link, ...(caption ? { caption: caption.slice(0, 1024) } : {}) } });
const botones = (to: string, body: string, opciones: string[]) => ({
  to, type: "interactive",
  interactive: {
    type: "button", body: { text: body.slice(0, 1024) },
    action: { buttons: opciones.slice(0, 3).map((t, i) => ({ type: "reply", reply: { id: `b${i}`, title: t.slice(0, 20) } })) },
  },
});

/* Lo que escribió el cliente, en texto plano para el agente */
function extraerTexto(m: Dict): string {
  const t = m.type as string;
  const g = (o: unknown, k: string) => (o && typeof o === "object" ? (o as Dict)[k] : undefined) as string | undefined;
  if (t === "text") return g(m.text, "body") ?? "";
  if (t === "interactive") {
    const i = m.interactive as Dict;
    return g(i?.button_reply, "title") ?? g(i?.list_reply, "title") ?? "";
  }
  if (t === "button") return g(m.button, "text") ?? "";
  if (t === "image") return `[El cliente envió una foto${g(m.image, "caption") ? `: "${g(m.image, "caption")}"` : ""}]`;
  if (t === "video") return `[El cliente envió un video${g(m.video, "caption") ? `: "${g(m.video, "caption")}"` : ""}]`;
  if (t === "audio") return "[El cliente envió una nota de voz; no puedes escucharla: pídele que lo escriba o escala]";
  if (t === "document") return `[El cliente envió un documento${g(m.document, "filename") ? `: ${g(m.document, "filename")}` : ""}]`;
  if (t === "sticker") return "[El cliente envió un sticker]";
  if (t === "location") return "[El cliente envió su ubicación]";
  if (t === "contacts") return "[El cliente envió un contacto]";
  if (t === "reaction") return "";
  return `[Mensaje de tipo ${t}]`;
}

/* ── Fotos: WhatsApp → Claude (visión) → descripción en texto para el agente ──
   El agente de Voiceflow no ve imágenes. Aquí se descarga la foto de la Cloud
   API y Claude la describe como lo haría un vendedor: tipo de pieza, metal y
   color aparente, piedra (forma, tamaño), banda, estilo, y si se parece a un
   diseño del catálogo (se le pasa la lista de nombres de la tienda). */
const TIPOS_IMAGEN = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
let catalogoCache: { nombres: string[]; ts: number } | null = null;

async function nombresCatalogo(): Promise<string[]> {
  if (catalogoCache && Date.now() - catalogoCache.ts < 3600_000) return catalogoCache.nombres;
  try {
    const r = await fetch("https://silvershine.com.do/products.json?limit=250");
    const d = await r.json();
    const set = new Set<string>();
    for (const p of (d.products ?? []) as { title?: string }[]) {
      // "Alma Unida - Set de 3 - Oro Sólido" → "Alma Unida"
      const base = String(p.title ?? "").split(" - ")[0].trim();
      if (base) set.add(base);
    }
    catalogoCache = { nombres: [...set].sort(), ts: Date.now() };
  } catch (e) {
    console.warn("catálogo:", (e as Error).message);
    if (!catalogoCache) catalogoCache = { nombres: [], ts: Date.now() };
  }
  return catalogoCache.nombres;
}

async function descargarMedia(mediaId: string): Promise<{ bytes: Uint8Array; mime: string } | null> {
  const meta = await fetch(`https://graph.facebook.com/${GRAPH}/${mediaId}`, { headers: { Authorization: `Bearer ${WA_ACCESS_TOKEN}` } });
  const info = await meta.json().catch(() => ({}));
  if (!meta.ok || !info.url) { console.warn("media:", info.error?.message ?? meta.status); return null; }
  const bin = await fetch(info.url, { headers: { Authorization: `Bearer ${WA_ACCESS_TOKEN}` } });
  if (!bin.ok) return null;
  return { bytes: new Uint8Array(await bin.arrayBuffer()), mime: String(info.mime_type ?? "image/jpeg").split(";")[0] };
}

const SISTEMA_VISION =
  "Eres el ojo de un vendedor de SilverShine, joyería fina de Santo Domingo (anillos de compromiso, tríos y aros de boda en plata 925, vermeil y oro sólido 10K/14K/18K, con circonia, moissanita o diamante de laboratorio). " +
  "Describe la imagen en español, en máximo 3 líneas y sin saludos, para que un asistente de ventas que NO ve la imagen pueda hablar de ella: " +
  "tipo de pieza (solitario, trío, dúo, aro, arete, otra), metal y color aparente (amarillo, blanco, rosa; si parece plata dilo), piedra central (forma: oval, redonda, pera, princesa, esmeralda, marquesa, corazón; tamaño relativo: pequeña, mediana, grande), piedras secundarias (pavé, halo, tres piedras, lisa), y estilo (clásico, vintage, moderno, minimalista). " +
  "Si la pieza se parece claramente a un diseño de la lista del catálogo, termina con: 'Se parece a <nombre>'. Si no, no inventes parecidos. " +
  "Si la imagen no es una joya (captura de pantalla, persona, recibo, otra cosa), di en una línea qué es. Nunca des precios ni kilataje: eso no se ve en una foto.";

async function describirImagen(bytes: Uint8Array, mime: string, contexto: string): Promise<string | null> {
  if (!ANTHROPIC_API_KEY || !TIPOS_IMAGEN.has(mime)) return null;
  const nombres = await nombresCatalogo();
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  const resp = await client.beta.messages.create({
    model: "claude-opus-5",
    max_tokens: 600,
    output_config: { effort: "low" },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SISTEMA_VISION,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: mime as "image/jpeg" | "image/png" | "image/gif" | "image/webp", data: encodeBase64(bytes) } },
        { type: "text", text: `Diseños del catálogo: ${nombres.join(", ") || "(no disponible)"}.${contexto ? ` ${contexto}` : ""}` },
      ],
    }],
  });
  if (resp.stop_reason === "refusal") return null;
  const texto = resp.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join(" ").trim();
  return texto || null;
}

/* Foto que manda el cliente por WhatsApp (media privada: se descarga con el token) */
async function describirFoto(mediaId: string, caption: string): Promise<string | null> {
  if (!WA_ACCESS_TOKEN || !mediaId) return null;
  const media = await descargarMedia(mediaId);
  if (!media) return null;
  return describirImagen(media.bytes, media.mime, caption ? `El cliente escribió junto a la foto: "${caption}".` : "");
}

/* Imagen del ANUNCIO que tocó el cliente (referral.image_url / thumbnail_url, URL pública).
   Sirve cuando el titular es genérico ("Anillos de compromiso") pero la foto dice qué pieza vio. */
const anuncioCache = new Map<string, string>();
async function describirAnuncio(ref: Referral): Promise<string | null> {
  const url = ref?.image_url || ref?.thumbnail_url;
  if (!url) return null;
  const clave = ref?.source_id || url;
  if (anuncioCache.has(clave)) return anuncioCache.get(clave)!;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const mime = (r.headers.get("content-type") || "image/jpeg").split(";")[0];
    const desc = await describirImagen(new Uint8Array(await r.arrayBuffer()), mime,
      `Es la imagen de un anuncio de SilverShine${ref?.headline ? ` titulado «${ref.headline}»` : ""}${ref?.body ? ` (texto: "${ref.body}")` : ""}.`);
    if (desc) anuncioCache.set(clave, desc);
    return desc;
  } catch (e) {
    console.warn("imagen del anuncio:", (e as Error).message);
    return null;
  }
}

/* ── Voiceflow Dialog Manager API ── */
async function vf(metodo: string, ruta: string, body?: unknown) {
  const r = await fetch(`${VF_DM_URL}${ruta}`, {
    method: metodo,
    headers: { Authorization: VF_API_KEY, versionID: VF_VERSION_ID, "Content-Type": "application/json", accept: "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`Voiceflow ${r.status}: ${txt.slice(0, 200)}`);
  return txt ? JSON.parse(txt) : null;
}
const interact = (uid: string, action: Dict) =>
  vf("POST", `/state/user/${q(uid)}/interact`, { action, config: { tts: false, stripSSML: true, stopAll: true, excludeTypes: ["block", "debug", "flow", "log"] } }) as Promise<Dict[]>;

/* Traces del agente → mensajes de WhatsApp (en orden) */
function tracesAMensajes(to: string, traces: Dict[]): { mensajes: Dict[]; escalar: string | null } {
  const out: Dict[] = [];
  let escalarMotivo: string | null = null;
  const p = (t: Dict) => (t.payload ?? {}) as Dict;
  for (const t of traces) {
    const tipo = t.type as string;
    if (tipo === "text" || tipo === "speak") {
      const msg = String(p(t).message ?? "").replace(/<[^>]+>/g, "").trim();
      if (msg) out.push(texto(to, msg));
    } else if (tipo === "visual") {
      const img = p(t).image as string | undefined;
      if (img) out.push(imagen(to, img));
    } else if (tipo === "choice") {
      const nombres = ((p(t).buttons ?? []) as Dict[]).map((b) => String(b.name ?? "")).filter(Boolean);
      if (!nombres.length) continue;
      // Los botones de WhatsApp necesitan un texto: se cuelgan del último mensaje de texto
      const ult = out.length && out[out.length - 1].type === "text" ? out.pop() as Dict : null;
      const body = ult ? String((ult.text as Dict).body) : "Elige una opción:";
      if (nombres.length <= 3) out.push(botones(to, body, nombres));
      else out.push(texto(to, `${body}\n\n${nombres.map((n, i) => `${i + 1}. ${n}`).join("\n")}`));
    } else if (tipo === "cardV2") {
      const c = p(t);
      const img = (c.imageUrl as string) || "";
      const txt = [c.title, c.description && (c.description as Dict).text].filter(Boolean).join("\n");
      if (img) out.push(imagen(to, img, txt)); else if (txt) out.push(texto(to, txt));
    } else if (tipo === "carousel") {
      // Hasta 5 fotos por carrusel: cuando piden "fotos de los anillos" se mandan de verdad
      for (const c of ((p(t).cards ?? []) as Dict[]).slice(0, 5)) {
        const img = (c.imageUrl as string) || "";
        const txt = [c.title, c.description && (c.description as Dict).text].filter(Boolean).join("\n");
        if (img) out.push(imagen(to, img, txt)); else if (txt) out.push(texto(to, txt));
      }
    } else if (tipo === "escalar" || tipo === "handoff") {
      escalarMotivo = String(p(t).motivo ?? p(t).message ?? "el agente pidió pasar con José");
    }
    // 'end', 'path', 'no-reply', etc.: nada que enviar
  }
  return { mensajes: out, escalar: escalarMotivo };
}

/* ── Mensaje entrante ── */
async function manejarMensaje(m: Dict, contactos: Dict[], pnid: string) {
  const wamid = String(m.id ?? "");
  if (!wamid || await yaVisto(wamid)) return;               // Meta reintenta: no procesar dos veces
  const tel = "+" + String(m.from ?? "").replace(/\D/g, "");
  const nombre = (((contactos?.[0] ?? {}) as Dict).profile as Dict | undefined)?.name as string | undefined ?? null;
  let contenido = extraerTexto(m);
  const ref = m.referral as Referral;
  let detalle: Dict | null = ref ? { referral: ref } : null;
  // Fotos: Claude las describe para que el agente sepa de qué anillo le hablan
  if (m.type === "image") {
    const img = (m.image ?? {}) as Dict;
    const caption = String(img.caption ?? "").trim();
    try {
      const desc = await describirFoto(String(img.id ?? ""), caption);
      if (desc) {
        contenido = `[Foto del cliente: ${desc}]${caption ? `\n${caption}` : ""}`;
        detalle = { ...(detalle ?? {}), foto: { media_id: img.id, descripcion: desc } };
      }
    } catch (e) {
      console.warn("descripción de foto:", (e as Error).message);
      detalle = { ...(detalle ?? {}), foto: { media_id: img.id, error: (e as Error).message } };
    }
  }
  await registrar({ wamid, telefono: tel, tipo: "in", contenido, detalle });
  if (!contenido) return;

  const chat = await chatDe(tel);
  const lead = await asegurarLead(tel, nombre, ref);
  const cambiosChat: Dict = { nombre: nombre ?? chat?.nombre ?? null, lead_id: lead.id, ultimo_mensaje_at: new Date().toISOString() };
  if (ref?.ctwa_clid || ref?.source_id) {
    Object.assign(cambiosChat, { ctwa_clid: ref.ctwa_clid ?? null, ad_id: ref.source_id ?? null, ad_headline: ref.headline ?? null, ad_url: ref.source_url ?? null, referral_at: new Date().toISOString() });
    // La imagen del anuncio dice qué pieza vio el cliente aunque el titular sea genérico
    const descAnuncio = await describirAnuncio(ref);
    if (descAnuncio) cambiosChat.ad_descripcion = descAnuncio;
  }
  const chatAct = await guardarChat(tel, cambiosChat);
  const adDescripcion = String((chatAct as unknown as Dict).ad_descripcion ?? "");

  if (pausado(chatAct)) { console.log("agente en pausa para", tel); return; }   // José está atendiendo
  if (!VF_API_KEY) { console.warn("Sin VF_API_KEY: el mensaje quedó registrado, sin respuesta"); return; }

  // Visto ✓✓ (no bloquea si falla)
  enviarWA(pnid, { status: "read", message_id: wamid }).catch(() => {});

  const uid = tel.replace(/\D/g, "");
  // Contexto para el agente: quién es, de qué anuncio viene y su lead_id (para el PATCH de calificado)
  await vf("PATCH", `/state/user/${q(uid)}/variables`, {
    telefono: tel, nombre_wa: nombre ?? "", lead_id: lead.id,
    origen: lead.origen ?? "organico", ad_headline: (chatAct as unknown as Dict).ad_headline ?? "",
    ad_descripcion: adDescripcion,
    desde_anuncio: lead.origen === "ad" ? "si" : "no", canal: "whatsapp", escalado: false,
  }).catch((e) => console.warn("variables:", e.message));

  let traces: Dict[] = [];
  try {
    if (!chatAct.vf_iniciado) {
      traces = traces.concat(await interact(uid, { type: "launch" }));
      await guardarChat(tel, { vf_iniciado: true });
    }
    traces = traces.concat(await interact(uid, { type: "text", payload: contenido }));
  } catch (e) {
    await registrar({ telefono: tel, tipo: "error", contenido: (e as Error).message });
    throw e;
  }

  const { mensajes, escalar: motivoTrace } = tracesAMensajes(tel.replace(/\D/g, ""), traces);
  for (const msg of mensajes) {
    try {
      const r = await enviarWA(pnid, msg);
      await registrar({ wamid: (r.messages?.[0]?.id as string) ?? undefined, telefono: tel, tipo: "out",
        contenido: msg.type === "text" ? String((msg.text as Dict).body) : msg.type === "interactive" ? String(((msg.interactive as Dict).body as Dict).text) : `[${msg.type}]` });
    } catch (e) {
      await registrar({ telefono: tel, tipo: "error", contenido: (e as Error).message, detalle: msg });
    }
  }

  // ¿El agente escaló? (trace propio o variable `escalado` = true)
  let motivo = motivoTrace;
  if (!motivo) {
    try {
      const st = (await vf("GET", `/state/user/${q(uid)}`)) as Dict;
      const v = (st?.variables ?? {}) as Dict;
      if (v.escalado === true || v.escalado === "true" || v.escalado === 1) motivo = String(v.motivo_escalado ?? "el agente pidió pasar con José");
    } catch { /* sin estado: nada */ }
  }
  if (motivo && !lead.escalado) await escalar(lead, tel, motivo);
}

/* ── Eco: José escribió desde su celular (coexistencia) ── */
async function manejarEco(e: Dict, _pnid: string) {
  const wamid = String(e.id ?? "");
  if (wamid && await yaVisto(wamid)) return;
  const tel = "+" + String(e.to ?? "").replace(/\D/g, "");
  if (tel === "+") return;
  const contenido = extraerTexto(e).trim();
  await registrar({ wamid: wamid || undefined, telefono: tel, tipo: "echo", contenido });
  const orden = contenido.toLowerCase();
  if (orden === "#bot") {
    await guardarChat(tel, { agente_pausado: false, pausado_hasta: null, motivo_pausa: null });
    await registrar({ telefono: tel, tipo: "pausa", contenido: "agente reactivado con #bot" });
    return;
  }
  // Cualquier otro mensaje de José = él tomó el chat: el agente se calla PAUSA horas
  await guardarChat(tel, {
    agente_pausado: true, pausado_hasta: new Date(Date.now() + PAUSA_MS).toISOString(),
    motivo_pausa: orden === "#yo" ? "pausado a mano con #yo" : "José respondió desde el celular",
    ultimo_echo_at: new Date().toISOString(),
  });
}

async function procesar(body: Dict) {
  for (const entry of ((body.entry ?? []) as Dict[])) {
    for (const ch of ((entry.changes ?? []) as Dict[])) {
      const v = (ch.value ?? {}) as Dict;
      const pnid = String(((v.metadata ?? {}) as Dict).phone_number_id ?? "");
      if (ch.field === "messages") {
        for (const m of ((v.messages ?? []) as Dict[])) {
          try { await manejarMensaje(m, (v.contacts ?? []) as Dict[], pnid); }
          catch (e) { console.error("mensaje:", (e as Error).message); }
        }
      } else if (ch.field === "smb_message_echoes") {
        for (const e of ((v.message_echoes ?? []) as Dict[])) {
          try { await manejarEco(e, pnid); } catch (err) { console.error("eco:", (err as Error).message); }
        }
      } else if (ch.field !== "statuses") {
        console.log("campo ignorado:", ch.field);
      }
    }
  }
}

/* ── Firma de Meta (X-Hub-Signature-256 = HMAC-SHA256 del cuerpo con el App secret) ── */
async function firmaValida(raw: string, header: string | null): Promise<boolean> {
  if (!WA_APP_SECRET) return true;                       // sin secreto configurado: no se verifica
  if (!header?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(WA_APP_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return hex === header.slice(7);
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method === "GET") {                             // verificación del webhook por Meta
    if (url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === WA_VERIFY_TOKEN) {
      return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
    }
    return new Response("verify token incorrecto", { status: 403 });
  }
  if (req.method !== "POST") return json({ error: "Solo GET/POST" }, 405);

  const raw = await req.text();
  if (!await firmaValida(raw, req.headers.get("x-hub-signature-256"))) return json({ error: "firma inválida" }, 401);
  let body: Dict;
  try { body = JSON.parse(raw); } catch { return json({ error: "JSON inválido" }, 400); }
  if (body.object && body.object !== "whatsapp_business_account") return json({ ok: true, ignorado: body.object });

  // Meta exige respuesta rápida: se contesta 200 y se procesa en segundo plano
  const tarea = procesar(body).catch((e) => console.error("wa-webhook:", (e as Error).message));
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(tarea); else await tarea;
  return json({ ok: true });
});
