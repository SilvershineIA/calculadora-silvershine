# Fase 1 — Activar WhatsApp Cloud API para SilverShine (paso a paso)

Objetivo: tener un número de WhatsApp conectado a la **Cloud API de Meta**, con el agente
(Voiceflow + Claude) respondiendo, y comprobar que los mensajes que llegan desde un anuncio
traen el `referral.ctwa_clid`. Esto es requisito de la Fase 2 (`SETUP-META-CAPI.md`).

---

## 0. Decide qué número va a la API (léelo antes de tocar nada)

Un número **no puede** estar al mismo tiempo en la app de WhatsApp / WhatsApp Business del
celular y en la Cloud API. Meta lo dice textual: los números en uso en WhatsApp no se pueden
registrar salvo que primero se elimine esa cuenta.

| Camino | Qué implica | Recomendado para |
|---|---|---|
| **Número nuevo solo para la API** | Compras una línea o eSIM. El 829-956-6588 sigue en tu celular como siempre. Los anuncios apuntan al número nuevo. | Empezar sin riesgo (**recomendado**) |
| **Migrar el 829-956-6588** | Debes borrar la cuenta en la app (Ajustes → Cuenta → Eliminar mi cuenta) tras exportar los chats. El número solo responde por la API; para atender a mano necesitas una bandeja de entrada conectada a la API (Voiceflow no trae una para humanos). | Después de tener el agente probado |

Los pasos siguientes sirven para cualquiera de los dos.

## 1. Cuenta de desarrollador de Meta

- Entra a <https://developers.facebook.com> con la **misma cuenta de Facebook que administra
  el Business Manager de SilverShine**. Botón *Comenzar / Get Started*, acepta las condiciones.
- Es gratis y no crea nada visible para los clientes.

## 2. Crear la app

1. <https://developers.facebook.com/apps> → **Crear app**.
2. Caso de uso: **"Conectar con clientes a través de WhatsApp"** (*Connect with customers
   through WhatsApp*).
3. Nombre: `SilverShine WhatsApp`. Correo de contacto: el tuyo.
4. **Portafolio de empresa:** elige el de SilverShine. (Si no aparece, es que la cuenta de
   Facebook con la que entraste no es administradora del Business Manager: corrígelo primero
   en <https://business.facebook.com/settings/people>.)
5. Crear app.

## 3. Configuración de la API (número de prueba)

1. En la app → menú izquierdo → **WhatsApp → Configuración de la API** (*API Setup*).
2. Meta asigna un **número de prueba** gratis y una cuenta de WhatsApp Business (WABA) de
   prueba. Con "Enviar mensaje" puedes mandarte un *hello_world* a tu celular para ver que
   todo vive.
3. Anota de esa pantalla:
   - **ID de la cuenta de WhatsApp Business (WABA ID)** → lo pide el CRM (`META_WABA_ID`).
   - **ID del número de teléfono** (*Phone number ID*) → lo pide Voiceflow.
   El token que aparece ahí es **temporal (24 h)**; el permanente sale en el paso 7.

## 4. Agregar el número real

1. Misma pantalla → **Agregar número de teléfono**.
2. Perfil del negocio: nombre visible `SilverShine`, categoría (Joyería / Tienda), descripción,
   sitio web `silvershine.com.do`, correo.
3. Número: el que decidiste en el paso 0. Verificación por **SMS o llamada**; escribe el código.
4. Requisitos:
   - El número **no** puede estar activo en ninguna app de WhatsApp (ver paso 0).
   - Hasta que la empresa esté verificada solo puedes registrar **2 números**.
5. Al terminar, anota el **nuevo Phone number ID** (cambia respecto al número de prueba).
6. El **nombre visible** pasa por revisión de Meta (estado *Pendiente* → *Aprobado*; puede
   tardar de minutos a días). Mientras, el número funciona igual.

## 5. Verificación de la empresa

- <https://business.facebook.com/settings/security> → **Iniciar verificación**.
- Piden: documento legal de la empresa (registro mercantil / RNC de Grupo Morillo Ciprian
  SRL) y un documento con dirección o teléfono a nombre de la empresa (factura de servicio,
  estado bancario). Tarda de horas a varios días.
- Sin verificar: límite de **250 conversaciones iniciadas por ti / día** y máximo 2 números.
  Verificado: el límite sube por escalones (1 000 → 10 000 → ilimitado) según el uso y la
  calidad del número. Las conversaciones que **inicia el cliente** (tu caso: clic en anuncio)
  no cuentan contra ese límite.

## 6. Método de pago

- Business Manager → **Configuración → Cuentas → Cuentas de WhatsApp** → tu cuenta →
  *Configuración* → **Método de pago** → agrega tarjeta.
- Qué se cobra: las **plantillas que inicias tú** (marketing, recordatorios). Responder dentro
  de las 24 h a un cliente que te escribió es **gratis**. Sin tarjeta, el número queda limitado
  a modo prueba.

## 7. Token permanente (usuario de sistema)

1. <https://business.facebook.com/settings/system-users> → **Agregar** → nombre
   `silvershine-api`, rol **Administrador**.
2. **Añadir activos**: la app `SilverShine WhatsApp` (control total) y la **cuenta de
   WhatsApp** (control total). Más adelante, para la Fase 2, también el **dataset** de
   Events Manager.
3. **Generar token** → elige la app → caducidad **Nunca** → permisos:
   `whatsapp_business_messaging`, `whatsapp_business_management`, `business_management`
   (para la Fase 2 agrega también `ads_management`).
4. **Cópialo y guárdalo** (gestor de contraseñas). Solo se muestra una vez.

## 8. Conectar Voiceflow

1. En Voiceflow → tu agente → **Publish / Integrations → WhatsApp**.
   Según la versión te ofrece *Conectar con Facebook* (registro incrustado, que hace los
   pasos 3-4 por ti) o pedir manualmente: **Phone number ID**, **WABA ID** y **token** del
   paso 7.
2. Voiceflow te devuelve una **URL de webhook** (*Callback URL*) y un **verify token**.
3. En tu app de Meta → **WhatsApp → Configuración** (*Configuration*) → **Webhook → Editar**:
   pega la URL y el verify token → *Verificar y guardar*.
4. En **Campos del webhook** → *Administrar* → suscribe **`messages`**.
5. La app debe estar en **modo activo** (*Live*), interruptor arriba de la app. Para tu propio
   negocio no hace falta revisión de app: el acceso estándar alcanza porque la app y la
   cuenta de WhatsApp pertenecen al mismo portafolio.

## 9. Prueba real (y el dato que decide la Fase 2)

1. Desde otro celular escríbele al número: el agente debe contestar.
2. En Ads Manager crea (o edita) un anuncio: objetivo **Interacción** → ubicación de la
   conversión **Aplicaciones de mensajería → WhatsApp** → elige el número de la API. La
   cuenta de WhatsApp debe estar **vinculada a la página de Facebook** de SilverShine
   (Business Manager → Cuentas de WhatsApp → *Configuración* → Página).
3. Haz clic tú mismo en el anuncio (vista previa o publicado) y escribe.
4. En Voiceflow revisa la transcripción / variables del mensaje entrante. Busca
   `referral` con `ctwa_clid`, `source_id`, `headline`.
   - **Aparece** → Fase 2 tal como está: Voiceflow lo manda a `leads`.
   - **No aparece** → plan B (`wa-webhook` en Supabase), descrito al final de
     `SETUP-META-CAPI.md`. Avísale a Claude con lo que viste.

## Qué llevarte de aquí a la Fase 2

- **WABA ID** (paso 3/4)
- **Phone number ID** (paso 4)
- **Token permanente** (paso 7)
- Confirmación de si llega el **`ctwa_clid`** (paso 9)

## Notas

- Docs oficiales: [Primeros pasos Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api/get-started) ·
  [Números de teléfono](https://developers.facebook.com/docs/whatsapp/cloud-api/phone-numbers) ·
  [Webhooks](https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks).
- Los botones 💬 del CRM usan `wa.me` y abren el WhatsApp **de tu celular**; si migras el
  829-956-6588 a la API, esos mensajes tendrás que mandarlos desde la bandeja conectada a la
  API, no desde la app. Con número nuevo, nada cambia en el CRM.
- El número de la API puede recibir llamadas normales si la línea lo permite; WhatsApp solo
  se usa por la API.
