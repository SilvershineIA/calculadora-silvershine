# Conectar el CRM SilverShine a Supabase (paso a paso)

Ya tienes la cuenta creada en supabase.com. Ahora sigue estos 4 pasos (una sola vez):

## 1. Crear el proyecto

1. Entra a [supabase.com/dashboard](https://supabase.com/dashboard) → botón **New project**.
2. Nombre: `crm-silvershine` (o el que quieras).
3. **Database password:** inventa una clave fuerte y **guárdala** (no la vas a necesitar a diario, pero no se puede recuperar).
4. Región: elige **East US (North Virginia)** — es la más cercana a RD.
5. Espera 1-2 minutos a que el proyecto termine de crearse.

## 2. Crear las tablas

1. En el menú izquierdo: **SQL Editor** → **New query**.
2. Abre el archivo `supabase-schema.sql` (está en esta carpeta), copia TODO su contenido y pégalo.
3. Botón **Run** (abajo a la derecha). Debe decir "Success. No rows returned".

## 3. Crear tu usuario

1. Menú izquierdo: **Authentication** → **Users** → **Add user** → **Create new user**.
2. Email: tu correo. Password: inventa la clave con la que entrarás al CRM.
3. Marca **Auto Confirm User** ✔ y crea.

## 4. Conectar la app

1. En Supabase: **Project Settings** (engranaje) → **Data API**: copia la **Project URL** (algo como `https://abcdefgh.supabase.co`).
2. En **Project Settings → API Keys**: copia la clave **anon / public**.
3. Abre el CRM → **Ajustes** → tarjeta **Nube (Supabase)**: pega la URL y la clave, pon tu correo y tu clave de usuario, y presiona **Conectar**.
4. La primera vez, la app subirá sola todos tus datos (clientes, facturas, pagos, cotizaciones y tareas).

## En el celular

Abre la app en el navegador del celular, ve a **Ajustes → Nube** y conecta con los
mismos datos. Como la nube ya tiene todo, la app descargará los datos automáticamente.
Luego usa "Agregar a pantalla de inicio" para instalarla como app.

## Notas

- La clave **anon/public** no es secreta en sí (por eso se llama pública): la seguridad
  la da tu usuario y clave — sin iniciar sesión nadie puede leer ni escribir nada.
- Plan gratis: 500 MB de base de datos (tus 3 años de historia pesan ~1 MB).
- Si pasas 7 días sin abrir la app, Supabase pausa el proyecto: se reactiva con un
  clic en el dashboard de supabase.com.
