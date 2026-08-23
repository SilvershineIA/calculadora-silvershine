# Taller SilverShine ✕ Tonglin — puesta en marcha (una sola vez)

La app del taller usa el **mismo proyecto de Supabase del CRM**. Solo hay que
agregarle una tabla, un almacén de archivos y el usuario de Karen. 3 pasos:

## 1. Crear el usuario de Karen (Tonglin)

1. [supabase.com/dashboard](https://supabase.com/dashboard) → tu proyecto del CRM.
2. **Authentication → Users → Add user → Create new user**.
3. Email: `taller@silvershine.com.do` · Password: inventa una clave LARGA
   (30+ letras y números revueltos — Karen nunca la escribirá, va dentro del link).
4. Marca **Auto Confirm User** ✔ y crea.

> Si usas otro email, edítalo también en `taller-schema.sql` (aparece 2 veces).

## 2. Correr el SQL

1. **SQL Editor → New query**.
2. Pega TODO el contenido de `taller-schema.sql` y presiona **Run**.
   Debe decir "Success. No rows returned".

Esto crea la tabla `taller`, el bucket de archivos, y **blinda el CRM**: el
usuario de Karen solo puede ver lo del taller — tus clientes, facturas y
finanzas le quedan invisibles aunque el link se filtre.

## 3. Generar el link de Karen

1. Abre la app del taller: `…/taller/` (mismo dominio del CRM).
2. Entra con TU correo y clave del CRM (los mismos de Ajustes → Nube).
3. Pestaña **Ajustes → Link para Tonglin**: pega el email y la clave del
   usuario de Karen (paso 1) y presiona **Generar link**.
4. Copia el link y mándaselo a Karen por WhatsApp **una sola vez**.
   Ella lo abre, lo ancla a su pantalla de inicio, y ya — sin usuario ni clave.

## Si el link se filtra

Supabase → **Authentication → Users** → usuario del taller → **Reset password**
(nueva clave) → generas un link nuevo en Ajustes y se lo mandas. El viejo muere solo.

## Notas

- La IA que lee los PDFs de Tonglin corre **en tu dispositivo** con la misma
  clave de Anthropic del CRM (Ajustes → 🤖 IA). Karen no necesita clave.
- Los archivos (fotos, PDFs, CADs, comprobantes) viven en el bucket `taller`
  del mismo proyecto — plan gratis: 1 GB (alcanza para años de fotos comprimidas).
