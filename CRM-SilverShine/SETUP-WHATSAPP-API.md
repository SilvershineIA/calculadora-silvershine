# Fase 1 — WhatsApp del 829-956-6588 con el agente (coexistencia) — paso a paso

**Decisión tomada (9 sep 2026):** todo sigue en el celular de José con el número de siempre.
Se activa la **coexistencia** de Meta: la app WhatsApp Business del celular y la Cloud API
comparten el 829-956-6588. El agente (Voiceflow + Claude) responde por la API; José responde a
mano desde el celular o WhatsApp Web como hoy; los chats se ven en ambos lados.

```
Cliente ──WhatsApp──▶ 829-956-6588 ──┬─▶ app del celular (José responde a mano)
                                     └─▶ Cloud API ──webhook──▶ Supabase: wa-webhook
                                                                  │  · guarda referral (ctwa_clid) → leads
                                                                  │  · pausa el bot si José ya respondió (eco)
                                                                  ▼
                                                        Voiceflow (agente Claude) ──▶ respuesta ──▶ Cloud API ──▶ cliente
```

Tres hechos que definen este camino:

1. **Voiceflow no tiene canal nativo de WhatsApp.** Su método oficial es un puente (un
   servidor que recibe los webhooks de Meta, llama al agente y devuelve la respuesta). Ese
   puente es la Edge Function **`wa-webhook`** de este repo, que además captura el clic del
   anuncio para la Fase 2.
2. **La coexistencia solo la activa un proveedor autorizado por Meta** (Tech Provider /
   Solution Partner) mediante su "registro incrustado" (Embedded Signup). No se puede hacer
   desde la app propia del panel de desarrolladores. Twilio no la soporta.
3. **La app "SilverShine CRM" del panel de desarrolladores sigue haciendo falta**: de ella
   sale el token permanente con el que `wa-webhook` envía mensajes y `meta-capi` reporta a
   Meta. En ella **no se registra ningún número**.

Archivos de esta fase:

| Archivo | Para qué |
|---|---|
| `supabase/functions/wa-webhook/index.ts` | El puente WhatsApp ↔ Voiceflow (referral, leads, pausa por eco, escalación) |
| `supabase/meta-capi-schema.sql` | Incluye las tablas `wa_chats` y `wa_eventos` y la columna `leads.escalado` |
| `supabase/config.toml` | `verify_jwt = false` para ambas funciones |

---

## 0. Requisitos previos en el celular

- App **WhatsApp Business** (no WhatsApp normal) actualizada, versión 2.24.17 o superior.
- El número lleva más de 7 días en esa app (el 829 lleva años: cumple).
- Ese celular debe **abrir la app al menos una vez cada 13 días**, o Meta desconecta la
  coexistencia.
- No se soporta la app **WhatsApp para Windows** como dispositivo vinculado (lo que escribas
  desde ahí no se refleja en la API). **WhatsApp Web en el navegador sí** funciona.

## 1. Cuenta de desarrollador y app de Meta ✅ (hecho el 8-9 sep)

App **SilverShine CRM**, caso de uso "Conectar con clientes a través de WhatsApp", portafolio
**"jose morillo"** (ID 670039773479134). Dentro del caso de uso quedan tres pasos de Meta:

- *Step 1. Try it out*: opcional. Sirve para mandarte un "hello world" desde el número de prueba.
- *Step 2. Production setup*: **no agregar número aquí** (lo hará el proveedor de coexistencia).
  De este paso solo se usan **System user / token** (paso 4 de esta guía) y **Webhooks**
  (paso 7). El método de pago lo pide el proveedor o Business Manager.
- *Step 3. Business verification*: paso 3 de esta guía.

## 2. Elegir el proveedor de coexistencia

| Proveedor | Precio aprox. | Cómo llegan los mensajes | Notas |
|---|---|---|---|
| **Dualhook** (dualhook.com) | ~US$12/mes por número | Reenvía los webhooks crudos de Meta a tu URL (`wa-webhook`) | El más barato y pensado para desarrolladores. Sin bandeja propia (no hace falta: José responde desde el celular). |
| **360dialog** (360dialog.com) | ~US$59/mes por número | Sus propios webhooks, formato compatible con Cloud API; envío por su API con su API key | Proveedor grande y establecido. `wa-webhook` necesitaría un ajuste pequeño para enviar por su endpoint. |

Recomendación: empezar con **Dualhook**. Si da problemas, 360dialog.

**Cómo se activa (en el proveedor elegido):**

1. Crear cuenta → "Conectar número de WhatsApp" → se abre el registro incrustado de Meta
   (inicias sesión con la cuenta de Facebook que administra "jose morillo").
2. Elegir el portafolio **"jose morillo"** (no se puede cambiar después).
3. Escribir el 829-956-6588 y marcar **"Sí, uso la app WhatsApp Business"** (*Yes, Business App*).
4. Meta manda un **código QR / código de acceso** a la app del celular: abrir WhatsApp
   Business → Ajustes → Herramientas para la empresa → *Conectar a la Plataforma de
   WhatsApp Business* (o escanear el QR que muestra la pantalla).
5. Confirmar **sincronizar historial y contactos** (hasta 6 meses de chats).
6. Al terminar, el proveedor muestra el **WABA ID** y el **Phone number ID** del 829. Anótalos.
   El WABA queda dentro del portafolio "jose morillo": ahí también se conectará el dataset
   (Fase 2).

## 3. Verificación de la empresa

<https://business.facebook.com/settings/security> → *Iniciar verificación*: documento legal
(registro mercantil / RNC de Grupo Morillo Ciprian SRL) y un comprobante con dirección o
teléfono a nombre de la empresa. Tarda de horas a días. Puede correr en paralelo con el paso 2.

## 4. Token permanente (usuario de sistema)

1. <https://business.facebook.com/settings/system-users> → **Agregar** → `silvershine-api`, rol
   **Administrador**.
2. **Añadir activos**: la app **SilverShine CRM** (control total) y la **cuenta de WhatsApp**
   creada en el paso 2 (control total). Para la Fase 2, también el **dataset**
   "SilverShine 2 - Confecciones".
3. **Generar token** → app SilverShine CRM → caducidad **Nunca** → permisos:
   `whatsapp_business_messaging`, `whatsapp_business_management`, `business_management`,
   `ads_management`.
4. Cópialo una sola vez y guárdalo en tu gestor de contraseñas. Nunca lo pegues en el chat ni
   en el repo.
5. Anota también el **App secret** de la app: panel de desarrolladores → App settings → Basic
   → *App secret* (Show). Sirve para que `wa-webhook` verifique que los webhooks vienen de Meta.

## 5. Voiceflow: API key y variables

1. Voiceflow → tu agente → **Settings → API keys** → crear una **Dialog Manager API key**.
   Guárdala como el token.
2. El puente le pasa al agente estas **variables** antes de cada turno (créalas en el agente
   con esos nombres exactos): `telefono`, `nombre_wa`, `lead_id`, `origen` (`ad`/`organico`),
   `desde_anuncio` (`si`/`no`), `ad_headline`, `canal`, `escalado`, `motivo_escalado`.
3. Para **escalar a José**, el agente pone `escalado = true` (y opcionalmente
   `motivo_escalado`). El puente marca el lead como "🔥 Te toca" en Mi Día y deja de responder
   ese chat 24 h.
4. Para **calificar**, el agente hace un paso API: `PATCH {SUPABASE_URL}/rest/v1/leads?id=eq.{lead_id}`
   con `{ "calificado": true, "nombre": …, "ocasion": …, "material": …, "resumen": … }`
   (detalle en `SETUP-META-CAPI.md`). Ya **no** hace falta que el agente cree el lead: lo crea
   `wa-webhook` al primer mensaje, con el referral del anuncio.

## 6. Desplegar el puente en Supabase

Primero el SQL (`supabase/meta-capi-schema.sql`, ver `SETUP-META-CAPI.md` paso 1: incluye las
tablas del puente). Luego, en esta PC:

```bash
cd "C:\Users\HP\Desktop\Calculadora de oro\CRM-SilverShine" && npx supabase secrets set WA_VERIFY_TOKEN=inventa-una-palabra WA_ACCESS_TOKEN=EAAB... WA_APP_SECRET=el-app-secret VF_API_KEY=VF.DM.... VF_VERSION_ID=production META_GRAPH_VERSION=v25.0
```

```bash
cd "C:\Users\HP\Desktop\Calculadora de oro\CRM-SilverShine" && npx supabase functions deploy wa-webhook --no-verify-jwt
```

La URL del webhook queda así: `https://TU-PROYECTO.supabase.co/functions/v1/wa-webhook`.

## 7. Conectar el webhook

**Con Dualhook:** en su panel, *Webhook override* → pegar la URL de arriba. Los webhooks de
Meta llegan directo al puente. Suscribir `messages` y `smb_message_echoes`.

**Con la app propia (si el proveedor lo permite o para pruebas):** panel de desarrolladores →
SilverShine CRM → WhatsApp → *Configuration* → Webhook → *Edit*: Callback URL = la URL de
arriba, Verify token = el `WA_VERIFY_TOKEN` → *Verify and save* → en *Webhook fields* suscribir
**`messages`** y **`smb_message_echoes`**. Recuerda el aviso de Meta: los webhooks reales solo
llegan con la app **publicada** (interruptor *Publish* del panel).

## 8. Prueba

1. Desde otro celular escribe al 829: el agente responde y el chat aparece también en tu app.
2. Responde tú algo desde tu celular en ese chat: el agente se calla (24 h). Escribe `#bot` en
   ese chat para reactivarlo; `#yo` para pausarlo a mano.
3. En el CRM → Mi Día → *Leads de WhatsApp* aparece el lead (orgánico).
4. Haz clic en un anuncio real de clic-a-WhatsApp y escribe: el lead debe salir con
   *📣 Anuncio · «titular»* y con clic de anuncio (sin la pastilla "sin clic de anuncio").
   Eso confirma que el `ctwa_clid` llega en coexistencia. Si no llega, avisa a Claude: la
   bitácora `wa_eventos` guarda el webhook completo para diagnosticar.
5. Con eso la Fase 2 (`SETUP-META-CAPI.md`) queda lista para probar de punta a punta.

## Notas

- La cuenta de WhatsApp debe estar vinculada a la **página "Confecciones SilverShine"** para
  que los anuncios de clic-a-WhatsApp puedan elegir ese número (Business Manager → Cuentas de
  WhatsApp → Configuración → Página).
- Los botones 💬 del CRM siguen igual: abren el chat en tu celular; lo que escribas desde ahí
  el puente lo ve como eco y pausa el bot en ese chat.
- Coexistencia no soporta: grupos, llamadas por API, mensajes temporales / ver una vez,
  ubicación en vivo, catálogo, listas de difusión (quedan solo lectura).
- Fuentes: [Meta: onboarding de usuarios de la app WhatsApp Business](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users) ·
  [360dialog: coexistencia](https://docs.360dialog.com/docs/hub/embedded-signup/coexistence-onboarding) ·
  [Voiceflow: integración de ejemplo con WhatsApp Cloud API](https://github.com/voiceflow-community/example-integration-whatsapp) ·
  [Comparativa de proveedores de coexistencia](https://dualhook.com/best-whatsapp-coexistence-providers).
