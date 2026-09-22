# Encender el agente de WhatsApp en el 829-956-6588 — la lista definitiva

**Versión del 22 sep 2026.** Reemplaza todas las versiones anteriores de esta guía. El plan
cambió varias veces (número nuevo → coexistencia → Claude directo); esta es la ruta final,
verificada contra la documentación de Dualhook y de Meta.

**Cómo queda todo:**

```
Cliente ──WhatsApp──▶ 829-956-6588 ──┬─▶ tu celular (app WhatsApp Business, como hoy)
                                     └─▶ Cloud API (coexistencia vía Dualhook)
                                              │ webhook directo de Meta
                                              ▼
                                   Supabase: wa-webhook + agente.ts (Claude)
                                              │ · crea el lead con el clic del anuncio
                                              │ · responde, califica, escala
                                              ▼
                                   respuesta ──▶ runtime de Dualhook ──▶ cliente
```

**Lo que YA NO hace falta** (aunque lo hayamos hecho o mencionado antes):

- ❌ Registrar un número en la app de desarrolladores de Meta. La app "SilverShine CRM" que
  creaste puede quedarse ahí sin uso; no la toques.
- ❌ Usuario de sistema, token permanente de Meta ni "App secret" para WhatsApp. Dualhook
  entrega su propia clave (`dh_live_…`) y los envíos salen por su runtime.
- ❌ Voiceflow. El agente es Claude dentro del puente.
- ❌ Comprar un chip nuevo. El 829 sigue en tu celular.

---

## LO QUE TE TOCA A TI (4 cosas, en este orden)

### 1. Verificación de empresa en Meta — empieza hoy, tarda días

- <https://business.facebook.com/settings/security> con la cuenta de Facebook que administra
  el portafolio **"jose morillo"** → **Iniciar verificación**.
- Documento legal de **Grupo Morillo Ciprian SRL** (registro mercantil / RNC) y un comprobante
  con dirección o teléfono a nombre de la empresa (factura de servicio, estado bancario).
- Mientras se aprueba, el número queda limitado a 250 conversaciones iniciadas por ti al día;
  las que inicia el cliente (tu caso) no cuentan. No hay que esperar la aprobación para el paso 2.

### 2. Conectar el 829 con coexistencia en Dualhook — 15 minutos

Requisitos en el celular: app **WhatsApp Business** actualizada (2.24.17 o superior). Abrirla al
menos una vez cada 13 días después de conectar, o Meta desconecta la coexistencia.

1. <https://dualhook.com/sign-up> → plan **Developer** (US$12/mes, 1 conexión, 14 días de prueba
   gratis; piden tarjeta pero no cobran hasta que termine la prueba).
2. En el panel, antes de conectar, te pide **Webhook URL** y **Verify token**. Pon:
   - Webhook URL: `https://TU-PROYECTO.supabase.co/functions/v1/wa-webhook?k=CLAVE-WEBHOOK`
     (TU-PROYECTO es el ref de tu Supabase, el mismo de Ajustes → Nube del CRM; CLAVE-WEBHOOK
     es una palabra larga que inventas ahora y anotas: se la daremos al puente como
     `WA_WEBHOOK_KEY`).
   - Verify token: otra palabra que inventas y anotas (`WA_VERIFY_TOKEN`).
   Si el panel pide el webhook después de conectar, no pasa nada: se pone luego.
3. **Connect with WhatsApp** → se abre la ventana de Meta:
   - Inicias sesión con la cuenta de Facebook del portafolio "jose morillo".
   - Escribes **829-956-6588** (o lo eliges si aparece como "Registered"). Meta muestra la tarjeta
     con el perfil de tu app (foto, nombre): eso confirma que va por coexistencia.
   - Eliges el portafolio **"jose morillo"** (no se puede cambiar después).
   - Aparece un **QR**: en el celular, WhatsApp Business → Ajustes → Cuenta → *Plataforma de
     WhatsApp Business* (o el mensaje verificado de Facebook Business que te llega) → escanear.
   - En el celular eliges **compartir el historial de chats** (decisión permanente; di que sí).
   - De vuelta en la ventana: confirma el nombre de la cuenta y la zona horaria
     (America/Santo_Domingo) → Finish.
4. En el panel de Dualhook copia y anota tres cosas: **Phone Number ID**, **WABA ID** y la
   **API key** (`dh_live_…`).
5. Apaga las respuestas automáticas de la app: WhatsApp Business → Herramientas para la
   empresa → desactivar la IA / saludo automático / mensaje de ausencia. Si no, responderían
   las dos.

### 3. Correr el SQL en Supabase — 5 minutos

1. Abre `CRM-SilverShine/supabase/meta-capi-schema.sql` con el Bloc de notas.
2. Arriba, dos líneas marcadas `← REEMPLAZA`: la URL de la función meta-capi con tu
   TU-PROYECTO, y una clave larga que inventas (`CAPI_WEBHOOK_SECRET`, anótala).
3. Supabase → **SQL Editor** → New query → pega todo → **Run** → *Success*.

### 4. Las claves de los servicios — 10 minutos

- **Anthropic**: la misma clave de "Foto a gasto" (Ajustes → IA del CRM). Si no la tienes a
  mano, <https://console.anthropic.com> → API keys.
- **Deepgram** (notas de voz): <https://console.deepgram.com> → cuenta gratis → API key.
- **Shopify Storefront** (precios para clientes fuera de RD; opcional): Shopify → Configuración
  → Apps y canales de venta → Desarrollar apps → Crear app "Agente WhatsApp" → Configuración →
  Storefront API → marcar lectura de productos → Instalar → copiar el token de Storefront.

---

## LO QUE HAGO YO (contigo al lado, una sesión de 30 minutos)

Cuando tengas lo de arriba, me avisas. En esta PC corres un solo comando para autorizarme:

```bash
npx supabase login
```

Y yo: vinculo el proyecto, cargo los secretos (Anthropic, Dualhook, Deepgram, las dos claves
del webhook, tu número personal para los avisos), despliego `wa-webhook` y `meta-capi`, y
verifico que Dualhook llegue al puente. Secretos que quedan puestos:

```
ANTHROPIC_API_KEY, WA_API_BASE=https://api.dualhook.com, WA_ACCESS_TOKEN=dh_live_…,
WA_WEBHOOK_KEY, WA_VERIFY_TOKEN, DEEPGRAM_API_KEY, WA_AVISO_NUMERO, WA_AVISO_PLANTILLA,
SHOPIFY_STOREFRONT_TOKEN (opcional), META_GRAPH_VERSION=v25.0
```

Luego la prueba: desde otro celular escribes al 829 y el bot responde; respondes tú desde tu
celular y el bot se calla (15 días; `#bot` lo reactiva). En el CRM, el lead aparece en Mi Día y
en su detalle se ve la conversación.

---

## Fase 2 (reporte a Meta), cuando lo anterior funcione

Tampoco necesita la app de desarrolladores:

1. **Events Manager** → tu dataset "SilverShine 2 - Confecciones" → **Configuración** →
   *Conversions API* → **Configurar manualmente** → **Generar token de acceso**. Meta crea sola
   un usuario de sistema para eso. Anota el token (`META_ACCESS_TOKEN`) y el ID del dataset.
2. En el mismo dataset, **conectarlo a la cuenta de WhatsApp** (WABA ID del paso 2).
3. Me pasas el token y el ID; yo cargo `META_DATASET_ID`, `META_ACCESS_TOKEN`, `META_WABA_ID`,
   `CAPI_WEBHOOK_SECRET` y probamos con el botón "Probar conexión con Meta" del CRM (Ajustes).

---

## Referencia técnica (para Claude)

| Archivo | Para qué |
|---|---|
| `supabase/functions/wa-webhook/index.ts` | El puente: webhooks (verify token + `?k=`), fotos, audios, ráfagas, pausa por eco, escalación, avisos |
| `supabase/functions/wa-webhook/agente.ts` | El agente: prompt (brief), herramientas, memoria, formato de salida |
| `supabase/functions/meta-capi/index.ts` | Reporte Lead / Purchase a Meta CAPI |
| `supabase/meta-capi-schema.sql` | Tablas `leads`, `capi_eventos`, `wa_chats`, `wa_eventos`, triggers |

- Dualhook: runtime compatible con Graph en `https://api.dualhook.com/v25.0/{phone_number_id}/messages`,
  `Authorization: Bearer dh_live_…`; media `GET /v25.0/{media_id}` → url de `/content`. Los webhooks
  de Meta llegan directo a nuestra URL (Webhook Override); como no tenemos el app secret de
  Dualhook, el puente exige `?k=WA_WEBHOOK_KEY` en la URL. Meta cobra las conversaciones aparte.
- Coexistencia: no soporta grupos, llamadas por API, mensajes temporales, ni WhatsApp para
  Windows como dispositivo vinculado (WhatsApp Web en el navegador sí).
- Fuentes: [Dualhook Runtime API](https://dualhook.com/docs/runtime-api-reference) ·
  [Dualhook Embedded Signup walkthrough](https://dualhook.com/docs/embedded-signup-walkthrough) ·
  [Dualhook pricing](https://dualhook.com/pricing) ·
  [Meta: onboarding de usuarios de la app WhatsApp Business](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users) ·
  [Meta: Conversions API get started](https://developers.facebook.com/docs/marketing-api/conversions-api/get-started/).
