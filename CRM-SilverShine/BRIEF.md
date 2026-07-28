# CRM SilverShine — Brief del proyecto

**Fecha:** 27 de julio de 2026
**Objetivo:** reemplazar QuickBooks Online (solo se usa el módulo de facturación) con una app propia de SilverShine, usable en PC y celular, con importación completa de los datos históricos de QuickBooks.

## Decisiones tomadas

| Tema | Decisión |
|---|---|
| Arquitectura de datos | Nube gratuita (Supabase) — sincronización automática entre PC y celular |
| Plataforma | PWA instalable (igual que la calculadora de oro), funciona en navegador y como app en el celular |
| Fiscal (RD) | Por defecto recibo simple; opción de asignar NCF e ITBIS 18% cuando el cliente lo pida |
| QuickBooks origen | QuickBooks Online — exportación a Excel/CSV desde Reportes |
| Pagos | Con abonos/pagos parciales: cada factura registra pagos con fecha y monto, muestra balance pendiente |
| Métodos de pago | Efectivo, transferencia, tarjeta y EasyPay — se registran como método en cada pago (sin integración automática) |
| Recordatorios a clientes | WhatsApp (mensaje prellenado con wa.me) y correo |
| Tareas | Módulo de tareas generales con fecha, vinculables a cliente o factura |
| Productos | Catálogo de productos frecuentes (con fotos) + líneas libres para piezas únicas y reparaciones |
| Calculadora de oro | Conexión: pasar el precio calculado de un anillo directo a una línea de factura |
| Moneda | DOP y USD por factura |
| Logo | El usuario tiene el logo en archivo — integrarlo en la app y en la factura impresa |
| Usuarios | Un solo usuario (el dueño) con su clave |
| Diseño | Paleta SilverShine de la calculadora: rosa #CF9B90, rosa oscuro #B07F74, rosa suave #F7ECE8, slate #343D48, canvas #FAF8F6, blanco #FFFFFF, línea #E7E2DD |

## Módulos

1. **Panel principal** — facturas recientes, pendientes de cobro (con balance), total facturado del mes.
2. **Clientes** — nombre, teléfono, correo, dirección, notas, fecha de registro, historial de facturas. Búsqueda por nombre/teléfono.
3. **Catálogo de productos** — nombre, descripción, precio (DOP/USD), categoría. Editable.
4. **Facturación** —
   - Número de factura automático (secuencia propia; conservar números históricos de QuickBooks).
   - Cliente, fecha, moneda (DOP/USD).
   - Líneas: producto del catálogo o línea libre (descripción, cantidad, precio).
   - Descuento, ITBIS opcional, NCF opcional.
   - Notas internas y notas visibles al cliente.
   - Estados: pendiente → pagada / anulada.
   - Abonos: lista de pagos (fecha, monto, método: efectivo / transferencia / tarjeta / EasyPay), balance pendiente automático.
   - Plan de pago opcional: cuotas con fecha y monto esperado (ej. RD$2,000 cada 15 días).
5. **Cotizaciones** (módulo aparte) —
   - Numeración propia (COT-001...), independiente de las facturas.
   - Mismas líneas que una factura (catálogo o libres, fotos, descuento), con fecha de vencimiento de la oferta.
   - Estados: borrador → enviada → aceptada / rechazada / vencida.
   - Envío por WhatsApp o correo, e impresión con el mismo diseño de la factura (marcada "COTIZACIÓN").
   - Botón **"Convertir en factura"**: al aceptarla, se crea la factura con todos los datos sin reescribir nada.
   - Pantalla de seguimiento: cotizaciones abiertas ordenadas por fecha, para dar seguimiento antes de que venzan.
6. **Cobros** — pantalla de cobros pendientes ordenada por urgencia: vencidos (rojo), próximos 7 días, resto. Recordatorio al cliente por WhatsApp (wa.me con mensaje prellenado: nombre, monto, balance) o correo. El panel principal siempre muestra los cobros vencidos.
7. **Tareas** — tareas generales con fecha ("recoger pieza donde el joyero"), vinculables a un cliente, factura o cotización; aparecen en el panel junto a los cobros del día.
8. **Impresión** — factura o cotización con logo y colores SilverShine, formato limpio para imprimir o guardar como PDF.
9. **Envío** — factura o cotización por correo o por WhatsApp con mensaje prellenado.
10. **Importación QuickBooks Online** — clientes y facturas históricas vía CSV/Excel; los datos deben verse igual que en QuickBooks (mismos números, fechas, montos).
11. **Respaldo** — exportar toda la base de datos a archivo descargable.
12. **Conexión con la calculadora de oro** — botón en la calculadora que pasa el precio calculado a una nueva línea de factura o cotización en el CRM.

## Stack técnico

- Frontend: HTML/CSS/JS (PWA, mismo estilo de la calculadora), carpeta `CRM-SilverShine/`.
- Backend: Supabase (plan gratuito) — Postgres + autenticación con correo/clave + API.
- Sin instalación de servidores: la app se sirve como archivos estáticos.

## Pendientes del usuario

- [ ] Colocar el archivo del logo (PNG/JPG) en la carpeta `CRM-SilverShine/`.
- [ ] Crear cuenta gratuita en supabase.com (guiado por Claude).
- [ ] Exportar de QuickBooks Online: Reportes → "Lista de clientes" y "Lista de transacciones/facturas" → Exportar a Excel.

## Fases de construcción

1. **Fase 1:** estructura de la app + base de datos Supabase + clientes y catálogo.
2. **Fase 2:** facturación completa (crear, editar, estados, abonos, planes de pago, NCF opcional).
3. **Fase 3:** módulo de cotizaciones (crear, estados, convertir en factura) + módulo de cobros y tareas con recordatorios (WhatsApp/correo).
4. **Fase 4:** impresión y envío (correo + WhatsApp).
5. **Fase 5:** importación de datos de QuickBooks y verificación uno a uno.
6. **Fase 6:** panel principal, respaldo, conexión con la calculadora, PWA instalable en el celular, pruebas finales.
