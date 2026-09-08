# Fase 2 — Leads de WhatsApp ↔ Meta Conversions API (paso a paso)

**Qué logra:** cuando el agente de WhatsApp califica un lead, Meta recibe un evento **Lead**;
cuando la factura nacida de ese lead se paga, Meta recibe **Purchase** con el monto. Ambos
llevan el `ctwa_clid` del clic original, así el algoritmo de anuncios aprende a buscar
**compradores** y no solo gente que escribe. Todo corre dentro de Supabase (triggers +
Edge Function): no depende de que el CRM esté abierto y **ningún token de Meta toca el
navegador ni el repositorio**.

```
Anuncio → WhatsApp → Voiceflow/Claude ──POST──▶ leads (Supabase)
                                                   │ calificado = true
                                                   ▼ trigger
CRM ── factura leadId → pagada ──▶ facturas ──▶ Edge Function meta-capi ──▶ Meta CAPI
                                    trigger        (Lead / Purchase + ctwa_clid)
```

Archivos de esta fase (carpeta `CRM-SilverShine/`):

| Archivo | Para qué |
|---|---|
| `supabase/meta-capi-schema.sql` | Tablas `leads` y `capi_eventos`, columna `facturas.lead_id`, seguridad, triggers |
| `supabase/functions/meta-capi/index.ts` | La Edge Function que habla con Meta |
| `supabase/config.toml` | Le dice al CLI que la función no exige JWT (los triggers usan su propio secreto) |
| `js/leads.js` | Lo que ves en el CRM: leads en Mi Día y Clientes, vincular, cotizar, sellos de Meta |

---

## Prerrequisitos (los haces tú en Meta; Claude no puede)

1. **Verificación de empresa** en Meta Business Manager — completada (puede tardar días).
2. **Dataset conectado al WABA.** En [Events Manager](https://business.facebook.com/events_manager2) →
   *Conectar orígenes de datos* → **Mensajería** (o dentro de la configuración de tu WhatsApp
   Business Account → *Conversions API*). Anota el **ID del dataset** (número largo).
3. **ID de la cuenta de WhatsApp Business (WABA).** Business Manager → Configuración →
   Cuentas → Cuentas de WhatsApp → el número que dice *ID de la cuenta de WhatsApp Business*.
4. **Token.** Business Manager → Configuración → Usuarios → **Usuarios del sistema** → crea uno
   (rol Administrador) → *Añadir activos*: el dataset (control total) y la cuenta de WhatsApp →
   **Generar token** con permisos `ads_management`, `business_management` y
   `whatsapp_business_management`. **Cópialo una sola vez y guárdalo**: se pega en el paso 3
   de abajo y nunca más se vuelve a ver.

## 1. Crear las tablas y los triggers (SQL Editor)

1. Abre `supabase/meta-capi-schema.sql` en un editor de texto.
2. En el bloque **Vault** (arriba) reemplaza:
   - `https://TU-PROYECTO.supabase.co/functions/v1/meta-capi` → tu URL real. El `TU-PROYECTO`
     es el mismo *ref* que ves en la URL del proyecto en Ajustes → Nube del CRM.
   - `PEGA-AQUI-UN-SECRETO-LARGO-Y-ALEATORIO` → inventa una clave larga (30+ caracteres,
     letras y números). **Guárdala**: es la misma que va en `CAPI_WEBHOOK_SECRET` (paso 3).
3. Supabase → **SQL Editor** → New query → pega TODO → **Run**. Debe decir *Success*.
   (Si te equivocas puedes correrlo otra vez: es idempotente.)

Qué acabas de crear:

- `leads` — lo que anota el agente. El teléfono se normaliza solo a `+1809…` (trigger).
- `capi_eventos` — bitácora: cada evento enviado a Meta con su respuesta o error.
- `facturas.lead_id` — columna derivada del `leadId` que el CRM guarda en el documento.
- Triggers: *lead calificado → Lead*, *factura pagada con lead → Purchase*. Llaman a la
  función con `Authorization: Bearer <tu secreto>`; nadie externo puede disparar eventos.
- Seguridad: la clave *anon* (la que usa Voiceflow) **solo puede insertar** leads, leer el
  `id` que le devuelve el insert y actualizar por `id` cinco campos. No lee teléfonos ni
  nada del CRM. El usuario del taller (Tonglin) no ve leads.

## 2. Instalar el CLI de Supabase (una vez, en esta PC)

No hace falta instalar nada global: `npx supabase` ya funciona (Node está instalado).

```bash
npx supabase login
```

Abre el navegador, inicias sesión en Supabase y listo. Luego vincula el proyecto (el
*ref* es el `xxxx` de `https://xxxx.supabase.co`):

```bash
cd "C:\Users\HP\Desktop\Calculadora de oro\CRM-SilverShine" && npx supabase link --project-ref TU-PROYECTO
```

Te pedirá la **Database password** del proyecto (la que inventaste al crearlo).

## 3. Secretos de la función (nunca en el repo)

Reemplaza los valores y corre (una sola línea):

```bash
cd "C:\Users\HP\Desktop\Calculadora de oro\CRM-SilverShine" && npx supabase secrets set META_DATASET_ID=123456789012345 META_ACCESS_TOKEN=EAAB... META_WABA_ID=987654321098765 META_GRAPH_VERSION=v25.0 CAPI_WEBHOOK_SECRET=el-mismo-secreto-del-paso-1
```

Opcional mientras pruebas: agrega `META_TEST_EVENT_CODE=TEST12345` (el código que da
Events Manager → *Probar eventos*). Los eventos salen marcados como prueba y se ven al
instante en esa pestaña. **Quítalo al terminar** con
`npx supabase secrets unset META_TEST_EVENT_CODE`.

## 4. Desplegar la función

```bash
cd "C:\Users\HP\Desktop\Calculadora de oro\CRM-SilverShine" && npx supabase functions deploy meta-capi --no-verify-jwt
```

`--no-verify-jwt` es obligatorio: los triggers no mandan un JWT de Supabase sino el secreto
propio; la función verifica ella misma quién la llama (secreto del webhook **o** el usuario
del CRM autenticado).

> Alternativa sin CLI: Supabase → Edge Functions → *Deploy a new function* → editor en línea
> → nombre `meta-capi`, pega el contenido de `index.ts`, **desactiva "Verify JWT"**, y pon los
> secretos en Edge Functions → *Secrets*.

## 5. Comprobar desde el CRM

Abre el CRM (versión 135 o superior) → **Ajustes** → tarjeta **📣 Meta · anuncios de WhatsApp**:

- Debe decir *🟢 Tabla de leads activa*. Si dice 🟠, falta el paso 1.
- **🔌 Probar conexión con Meta**: muestra ✅/❌ por cada secreto y si Meta responde con el
  nombre del dataset. Si dice *no está desplegada*, falta el paso 4.
- **📜 Últimos eventos enviados**: la bitácora `capi_eventos`.

## 6. Prueba de punta a punta (criterio de "terminado")

1. **Inserta un lead de prueba** con un `ctwa_clid` real (de un mensaje que de verdad haya
   entrado desde un anuncio; se ve en el webhook de WhatsApp o en Voiceflow). SQL Editor:

   ```sql
   insert into leads (telefono, nombre, origen, ad_headline, ctwa_clid, ocasion, material)
   values ('809-555-0000', 'Prueba CAPI', 'ad', 'Anillos de compromiso', 'PEGA_EL_CTWA_CLID', 'compromiso', 'oro');
   ```

   → Aparece en **Mi Día → Leads de WhatsApp** (toca ↻ si no).
2. **Calificar** (botón ✔ en la fila) → en unos segundos la fila muestra *📣 Lead ✓* y en
   Events Manager → *Probar eventos* (o *Resumen*) aparece **Lead** con
   `action_source = business_messaging`, atribuido al anuncio.
3. **Facturar** desde el lead (⋯ → 🧾 Facturar; el cliente se crea solo por teléfono),
   registrar el abono completo → la factura pasa a **pagada** → en su detalle aparece
   *📣 Reportado a Meta ✓* y Events Manager muestra **Purchase** con el monto y la moneda
   real de la factura (DOP o USD, sin convertir).
4. **Lead sin `ctwa_clid`**: inserta otro sin ese campo y califícalo → NO se envía nada; la fila
   dice *sin clic de anuncio* y la bitácora anota `sin ctwa_clid`.
5. **Ningún token en el repo ni en el bundle**: `git grep -i "EAAB"` no devuelve nada; el
   frontend solo llama a la función con el JWT del usuario.

Si un evento falló (❌ en la bitácora, o ⚠ en la fila), abre el lead (⋯) y usa
**🔁 Reenviar … a Meta ahora**: la función reintenta con la configuración actual.

## Lado Voiceflow (qué debe mandar el agente)

Paso *API* tras la calificación. Crear el lead:

```
POST {SUPABASE_URL}/rest/v1/leads?select=id
Headers:
  apikey: <anon key>
  Authorization: Bearer <anon key>
  Content-Type: application/json
  Prefer: return=representation
Body:
{
  "telefono": "{phone}",              // como venga; la base lo normaliza a +1809…
  "nombre": "{nombre}",
  "origen": "ad",                     // ad | organico | instagram | web
  "ad_id": "{referral.source_id}",
  "ad_headline": "{referral.headline}",
  "ctwa_clid": "{referral.ctwa_clid}", // SIN esto Meta no atribuye nada
  "ocasion": "compromiso",            // compromiso | trio | duo | aros | regalo | confeccion
  "material": "oro",                  // plata | vermeil | oro
  "calificado": false,
  "resumen": "{sintesis}"
}
Respuesta: [{"id":"uuid…"}]  → guarda ese id en una variable (lead_id)
```

Cuando el agente decida que el lead está calificado:

```
PATCH {SUPABASE_URL}/rest/v1/leads?id=eq.{lead_id}
Headers: los mismos (Prefer: return=minimal)
Body: { "calificado": true, "resumen": "{sintesis actualizada}" }
```

Ese PATCH es lo que dispara el evento **Lead** a Meta. (La clave anon solo puede tocar
`nombre, ocasion, material, calificado, resumen` y solo filtrando por `id`.)

### Riesgo abierto: ¿Voiceflow expone `referral`?

Se prueba en la Fase 1 con un mensaje real desde un anuncio. Si el conector de WhatsApp de
Voiceflow **no** entrega `messages[0].referral` (`ctwa_clid`, `source_id`, `headline`), el plan B
es una Edge Function `wa-webhook` en este mismo Supabase:

1. Meta manda el webhook de WhatsApp Cloud API a `…/functions/v1/wa-webhook`.
2. La función guarda `referral` por teléfono (tabla `wa_referrals`: `telefono`, `ctwa_clid`,
   `ad_id`, `headline`, `visto_at`) y reenvía el mensaje a Voiceflow por el *Dialog Manager API*.
3. El trigger `leads_antes_de_guardar` se amplía: si el lead llega sin `ctwa_clid`, lo toma
   del último `wa_referrals` del mismo teléfono (ventana de 7 días).

El diseño de tablas y la función `meta-capi` ya no cambiarían: solo se rellena `ctwa_clid`
por otra vía. **No se implementa hasta confirmar** que hace falta.

## Notas

- Versión del Graph API: **v25.0** (la v23.0 que decía el brief expiró en junio de 2026).
  Se cambia con el secreto `META_GRAPH_VERSION` sin tocar código.
- Para WhatsApp, Meta exige en `user_data` **`ctwa_clid` y `whatsapp_business_account_id`**;
  por eso `META_WABA_ID` es obligatorio (no solo para logs). El teléfono va además como `ph`
  (SHA-256 del número sin `+`).
- Idempotencia: `event_id` = `<lead>-lead` y `<factura>-purchase`. Un lead no se reporta dos
  veces; una factura tampoco. Si el mismo lead compra dos facturas, cada una es un Purchase.
- Ventana de atribución: los eventos se mandan al momento; Meta atribuye mejor dentro de
  los 7 días del clic, pero después igual se envían.
- Si Supabase pausa el proyecto (7 días sin uso en plan gratis), los triggers no corren
  hasta reactivarlo; los pendientes se pueden reenviar desde el detalle del lead.
