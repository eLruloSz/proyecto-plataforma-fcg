# Sistema de gestión — Beca Carmen Goudie

Plataforma para la Fundación Carmen Goudie: gestiona la invitación a liceos, la
recepción de nóminas de notas, la selección de invitados y la comunicación por
correo del proceso de selección de becarios.

**Estado:** etapa 1 (Invitación a establecimientos) completa de punta a punta, más el
avance entre etapas (requisitos, pasa/no pas# Sistema de gestión — Beca Carmen Goudie

Plataforma para la Fundación Carmen Goudie: gestiona la invitación a liceos, la
recepción de nóminas de notas, la selección de invitados y la comunicación por
correo del proceso de selección de becarios.

**Estado:** etapa 1 (Invitación a establecimientos) completa de punta a punta, más el
avance entre etapas (requisitos, pasa/no pasa con confirmación, avisos), la alerta de
pendientes en el dashboard y el informe por liceo para la contraparte.

| Carpeta | Contenido |
|---|---|
| `backend/` | API en NestJS (TypeScript) |
| `frontend/` | Interfaz en React + Vite + Tailwind |
| `db/` | Esquema SQL, datos de prueba y nóminas de ejemplo |
| `scripts/` | Generador de nóminas de prueba a partir de la plantilla real |

## Levantar en local

Requisitos: Docker y Node.js 20 o superior.

```bash
# 1. Base de datos y buzón de prueba
docker compose up -d

# 2. Backend (http://localhost:3000/api, documentación en /api/docs)
cd backend
cp .env.example .env
npm install
npm run start:dev

# 3. Frontend (http://localhost:5173), en otra terminal
cd frontend
npm install
npm run dev
```

Usuarios de prueba: `coordinacion@fcg.cl` y `direccion@fcg.cl`, contraseña `Demo1234!`.

Los correos **no salen a internet**: llegan a Mailpit, que se ve en
<http://localhost:8025>. Ahí puedes abrir cada correo, ver el asunto con las
variables reemplazadas y descargar los adjuntos.

Para probar la carga de nóminas, usa los Excel de `db/nominas-demo/`
(alumnos inventados, en el formato real de la plantilla). El del liceo 05 trae
errores a propósito para ver cómo se muestran antes de confirmar.

**Sin instalar Node** (todo en contenedores): `docker compose --profile app up -d --build`
y abrir <http://localhost:8080>.

La base queda en el puerto **5433** de tu máquina (no el 5432 habitual), para no
chocar con un PostgreSQL que ya tengas instalado. Si también está ocupado:
`DB_PORT=5434 docker compose up -d` y ajusta `DATABASE_URL` en `backend/.env`.

**Volver a cargar la base desde cero** (borra todo): `docker compose down -v && docker compose up -d`.

**Actualizar una base que ya tenías** (sin borrar datos): aplica las migraciones que le
falten, en orden. Todas se pueden aplicar más de una vez sin problema, por ejemplo:

```bash
docker exec -i becas-db psql -U becas -d becas < db/03_avance_etapas.sql
docker exec -i becas-db psql -U becas -d becas < db/07_generaciones.sql
```

## Flujo de la etapa 1

1. **Correo de presentación** (Comunicación → Nuevo correo → plantilla "Presentación").
   Antes de enviar se ve la lista de destinatarios; los liceos sin email quedan
   fuera con el motivo. Se puede enviar a "Todos los directores" o a
   "Todas las contrapartes".
2. **Marcar respuestas** en el detalle del envío: casilla "Respondió" y, en el
   correo de presentación, si el liceo participa o no. Un liceo que no participa
   deja de recibir los envíos grupales.
3. **Solicitud de notas**, con la plantilla Excel como adjunto fijo de la plantilla de correo.
4. **Subir la nómina** de cada liceo (Liceos y nóminas → liceo → Subir nómina).
   Se previsualiza antes de guardar: errores (filas que no se cargan) y
   advertencias (se cargan, pero conviene revisar). Al confirmar, el sistema
   marca solo la solicitud de notas de ese liceo como respondida.
5. **Elegir invitados**: el sistema ordena por promedio dentro de cada curso y
   sugiere los N primeros (N configurable; los empates entran todos). Al
   invitar se genera el Id, ej. `05.006a`.
6. **Invitados**: completar email y teléfono, registrar si aceptó postular
   (formulario 1), el encuentro online elegido y la asistencia.
7. **Reenviar a los que faltan**: desde cualquier envío, un recordatorio solo
   para quienes no han respondido, usando los datos de contacto actuales.

El **Seguimiento por liceo** reemplaza la planilla con semáforo: los hitos se
marcan solos cuando el sistema puede saberlo (correo enviado, respuesta
marcada, nómina subida) y se pueden marcar a mano con un clic.

## Avance entre etapas

Cada etapa tiene su propia configuración: nombre, **cupo** y **requisitos**
(documentos o pasos que cada estudiante debe cumplir, por ejemplo formulario,
cartola RSH, certificado de notas). Se configuran en *Avance por etapa →
Configurar etapas* y en el botón *Requisitos* de cada etapa. También se puede
**agregar una etapa entre dos existentes** o eliminar una que esté vacía.

En *Avance por etapa*:

1. Se marca por estudiante qué requisitos cumplió (casillas).
2. Se marca **Pasa / No pasa**. Son marcas provisorias: nada cambia hasta
   apretar **Confirmar avance**, que muestra la lista de quiénes pasan y quiénes
   no (y avisa si se supera el cupo) antes de aplicar.
3. Al confirmar, los que pasan quedan en la etapa siguiente y los que no, fuera
   del proceso. Una confirmación se puede deshacer mientras el estudiante no
   tenga resultados en la etapa siguiente.
4. *Avisar a los que pasan / no pasan* abre un correo solo para los que aún no
   han sido avisados; al enviarlo quedan marcados como avisados.
   *Recordar requisitos pendientes* escribe solo a quienes les falta algo, y la
   variable `{{documentos_pendientes}}` pone la lista de lo que le falta a cada uno.

En la etapa 1, *Marcar según respuesta a la invitación* marca "pasa" a quienes
aceptaron postular y "no pasa" a quienes rechazaron.

**Dashboard:** el recuadro *Pendientes* reúne lo que requiere acción —
estudiantes con documentos pendientes (por requisito), decisiones sin
confirmar, resultados sin avisar, invitados sin respuesta, sin email y correos
rebotados—, cada uno con enlace a donde se resuelve.

**Informe por liceo:** en la ficha de cada liceo, *Seguimiento de estudiantes*
muestra en qué etapa va cada uno y qué le falta. *Enviar informe a la
contraparte* usa la plantilla con `{{estudiantes}}`, que se reemplaza por esa
lista al enviar.

## Generaciones (histórico)

Antes de iniciar el proceso del año, la pantalla de inicio muestra las
**Generaciones**: una tarjeta por año con el embudo (invitados → cada etapa →
becarios) y los liceos convocados. También están en el menú *Generaciones*
mientras hay un proceso en curso.

- **Al cerrar un proceso** se guarda una foto del año (`procesos.resumen`):
  embudo por etapa, resultados por liceo, becarios, nóminas recibidas, ranking
  subido, entrevistas y correos enviados. El detalle se lee de esa foto, así
  que no cambia aunque después se editen liceos o contactos.
- **Un proceso cerrado no se reabre**: solo se consulta.
- **Generaciones anteriores al sistema**: *Agregar generación anterior* permite
  ingresar a mano los números del embudo y la lista de becarios. Solo estas se
  pueden corregir o eliminar.
- **Iniciar proceso** tiene la opción *Usar la generación anterior como base*:
  copia sus etapas (cupos y requisitos) y deja marcados los mismos liceos que
  participaron. Las plantillas de correo y los contactos de los liceos no
  dependen del año, así que siempre se mantienen.
- En el histórico solo quedan números y los becarios: no se copian los datos
  personales de los demás postulantes.

## Decisiones de diseño

- **Nómina separada de postulaciones.** Los liceos envían a todos sus alumnos
  de 3° medio; solo los invitados pasan a ser postulaciones. De los demás se
  guarda lo mínimo para poder ordenar.
- **Id de invitado = liceo + correlativo del año + sufijo** (`01.001a`,
  `01.002a`, `02.003a`…), igual que en las planillas de la fundación. El
  correlativo no se reinicia por liceo y un Id entregado no se reutiliza. El
  sufijo es configurable por proceso.
- **La lectura del Excel busca las columnas por su título**, no por posición:
  los liceos modifican la plantilla. Acepta notas como `6,5`, `6.5` o `65`.
- **Cada destinatario recibe su propio correo**, nunca un correo grupal con
  todos en copia.
- **Entrega vs. respuesta.** La entrega (enviado, entregado, rebotó) la sabe el
  sistema; los rebotes llegan por el webhook del proveedor
  (`POST /api/webhooks/correo?token=…`, formato Brevo). La respuesta la marca
  la persona, porque las respuestas llegan a la bandeja de la fundación.
- **El esquema vive en `db/01_schema.sql`** (una sola fuente de verdad).
  TypeORM se usa para la conexión y las transacciones; las consultas son SQL
  parametrizado.

## Pruebas

```bash
cd backend
npm test                          # lector de nóminas con la plantilla real (13 pruebas)
node test/flujo-etapa1.mjs        # recorrido completo contra la API (base recién cargada)
node test/flujo-avance.mjs        # avance entre etapas (correr después del anterior)
node test/flujo-generaciones.mjs  # histórico de generaciones (correr al final: cierra el proceso 2026)
```

`flujo-etapa1.mjs` recorre el proceso completo: login, correo de presentación,
respuestas, recordatorio, solicitud con adjunto, carga de nóminas con errores,
invitación y generación de Id, datos de contacto, webhook de rebote, dashboard
y cambio de etapa. `flujo-avance.mjs` sigue desde ahí: marcar según la
invitación, confirmar, deshacer, avisos solo a los no avisados, requisitos,
recordatorio a quienes les faltan documentos, alerta del dashboard, informe por
liceo y agregar/editar/eliminar etapas.

## Producción

- Definir `ADMIN_EMAIL` / `ADMIN_PASSWORD` para crear el primer usuario (no
  cargar `02_datos_demo.sql`).
- Configurar el SMTP del proveedor (`SMTP_*`) y el webhook de eventos con
  `MAIL_WEBHOOK_TOKEN`.
- `JWT_SECRET` largo y aleatorio. Servir detrás de HTTPS.
- Respaldar la base y la carpeta `UPLOAD_DIR` (adjuntos).
- El esquema funciona en PostgreSQL 11 o superior (probado en 16). El informe
  del equipo anterior menciona PostgreSQL 10 en el servidor del cliente: en esa
  versión los triggers deben escribirse `EXECUTE PROCEDURE` en vez de
  `EXECUTE FUNCTION`. Confirmar la versión con `SELECT version();` antes de desplegar.

## Pendiente (siguientes etapas)

- Datos de la etapa de postulación por estudiante: % RSH, tramo, personas con
  invalidez o que requieren apoyo, y comparación de integrantes del hogar
  (formulario vs. RSH) — a la espera de definir el detalle con la fundación
- Posible etapa adicional entre la 2 y la 3 (el sistema ya permite insertarla)

- Carga del Excel de puntajes y vista del ranking (Preselección N°1)
- Cortes del ranking, entrevistas con la pauta de entrevista y selección final
- Aceptación del liceo para los seleccionados
a con confirmación, avisos), la alerta de
pendientes en el dashboard y el informe por liceo para la contraparte.

| Carpeta | Contenido |
|---|---|
| `backend/` | API en NestJS (TypeScript) |
| `frontend/` | Interfaz en React + Vite + Tailwind |
| `db/` | Esquema SQL, datos de prueba y nóminas de ejemplo |
| `scripts/` | Generador de nóminas de prueba a partir de la plantilla real |

## Levantar en local

Requisitos: Docker y Node.js 20 o superior.

```bash
# 1. Base de datos y buzón de prueba
docker compose up -d

# 2. Backend (http://localhost:3000/api, documentación en /api/docs)
cd backend
cp .env.example .env
npm install
npm run start:dev

# 3. Frontend (http://localhost:5173), en otra terminal
cd frontend
npm install
npm run dev
```

Usuarios de prueba: `coordinacion@fcg.cl` y `direccion@fcg.cl`, contraseña `Demo1234!`.

Los correos **no salen a internet**: llegan a Mailpit, que se ve en
<http://localhost:8025>. Ahí puedes abrir cada correo, ver el asunto con las
variables reemplazadas y descargar los adjuntos.

Para probar la carga de nóminas, usa los Excel de `db/nominas-demo/`
(alumnos inventados, en el formato real de la plantilla). El del liceo 05 trae
errores a propósito para ver cómo se muestran antes de confirmar.

**Sin instalar Node** (todo en contenedores): `docker compose --profile app up -d --build`
y abrir <http://localhost:8080>.

La base queda en el puerto **5433** de tu máquina (no el 5432 habitual), para no
chocar con un PostgreSQL que ya tengas instalado. Si también está ocupado:
`DB_PORT=5434 docker compose up -d` y ajusta `DATABASE_URL` en `backend/.env`.

**Volver a cargar la base desde cero** (borra todo): `docker compose down -v && docker compose up -d`.

**Actualizar una base que ya tenías** (sin borrar datos): las bases creadas antes del
avance por etapas necesitan la migración 03, que se puede aplicar más de una vez sin problema:

```bash
docker exec -i becas-db psql -U becas -d becas < db/03_avance_etapas.sql
```

## Flujo de la etapa 1

1. **Correo de presentación** (Comunicación → Nuevo correo → plantilla "Presentación").
   Antes de enviar se ve la lista de destinatarios; los liceos sin email quedan
   fuera con el motivo. Se puede enviar a "Todos los directores" o a
   "Todas las contrapartes".
2. **Marcar respuestas** en el detalle del envío: casilla "Respondió" y, en el
   correo de presentación, si el liceo participa o no. Un liceo que no participa
   deja de recibir los envíos grupales.
3. **Solicitud de notas**, con la plantilla Excel como adjunto fijo de la plantilla de correo.
4. **Subir la nómina** de cada liceo (Liceos y nóminas → liceo → Subir nómina).
   Se previsualiza antes de guardar: errores (filas que no se cargan) y
   advertencias (se cargan, pero conviene revisar). Al confirmar, el sistema
   marca solo la solicitud de notas de ese liceo como respondida.
5. **Elegir invitados**: el sistema ordena por promedio dentro de cada curso y
   sugiere los N primeros (N configurable; los empates entran todos). Al
   invitar se genera el Id, ej. `05.006a`.
6. **Invitados**: completar email y teléfono, registrar si aceptó postular
   (formulario 1), el encuentro online elegido y la asistencia.
7. **Reenviar a los que faltan**: desde cualquier envío, un recordatorio solo
   para quienes no han respondido, usando los datos de contacto actuales.

El **Seguimiento por liceo** reemplaza la planilla con semáforo: los hitos se
marcan solos cuando el sistema puede saberlo (correo enviado, respuesta
marcada, nómina subida) y se pueden marcar a mano con un clic.

## Avance entre etapas

Cada etapa tiene su propia configuración: nombre, **cupo** y **requisitos**
(documentos o pasos que cada estudiante debe cumplir, por ejemplo formulario,
cartola RSH, certificado de notas). Se configuran en *Avance por etapa →
Configurar etapas* y en el botón *Requisitos* de cada etapa. También se puede
**agregar una etapa entre dos existentes** o eliminar una que esté vacía.

En *Avance por etapa*:

1. Se marca por estudiante qué requisitos cumplió (casillas).
2. Se marca **Pasa / No pasa**. Son marcas provisorias: nada cambia hasta
   apretar **Confirmar avance**, que muestra la lista de quiénes pasan y quiénes
   no (y avisa si se supera el cupo) antes de aplicar.
3. Al confirmar, los que pasan quedan en la etapa siguiente y los que no, fuera
   del proceso. Una confirmación se puede deshacer mientras el estudiante no
   tenga resultados en la etapa siguiente.
4. *Avisar a los que pasan / no pasan* abre un correo solo para los que aún no
   han sido avisados; al enviarlo quedan marcados como avisados.
   *Recordar requisitos pendientes* escribe solo a quienes les falta algo, y la
   variable `{{documentos_pendientes}}` pone la lista de lo que le falta a cada uno.

En la etapa 1, *Marcar según respuesta a la invitación* marca "pasa" a quienes
aceptaron postular y "no pasa" a quienes rechazaron.

**Dashboard:** el recuadro *Pendientes* reúne lo que requiere acción —
estudiantes con documentos pendientes (por requisito), decisiones sin
confirmar, resultados sin avisar, invitados sin respuesta, sin email y correos
rebotados—, cada uno con enlace a donde se resuelve.

**Informe por liceo:** en la ficha de cada liceo, *Seguimiento de estudiantes*
muestra en qué etapa va cada uno y qué le falta. *Enviar informe a la
contraparte* usa la plantilla con `{{estudiantes}}`, que se reemplaza por esa
lista al enviar.

## Decisiones de diseño

- **Nómina separada de postulaciones.** Los liceos envían a todos sus alumnos
  de 3° medio; solo los invitados pasan a ser postulaciones. De los demás se
  guarda lo mínimo para poder ordenar.
- **Id de invitado = liceo + correlativo del año + sufijo** (`01.001a`,
  `01.002a`, `02.003a`…), igual que en las planillas de la fundación. El
  correlativo no se reinicia por liceo y un Id entregado no se reutiliza. El
  sufijo es configurable por proceso.
- **La lectura del Excel busca las columnas por su título**, no por posición:
  los liceos modifican la plantilla. Acepta notas como `6,5`, `6.5` o `65`.
- **Cada destinatario recibe su propio correo**, nunca un correo grupal con
  todos en copia.
- **Entrega vs. respuesta.** La entrega (enviado, entregado, rebotó) la sabe el
  sistema; los rebotes llegan por el webhook del proveedor
  (`POST /api/webhooks/correo?token=…`, formato Brevo). La respuesta la marca
  la persona, porque las respuestas llegan a la bandeja de la fundación.
- **El esquema vive en `db/01_schema.sql`** (una sola fuente de verdad).
  TypeORM se usa para la conexión y las transacciones; las consultas son SQL
  parametrizado.

## Pruebas

```bash
cd backend
npm test                          # lector de nóminas con la plantilla real (13 pruebas)
node test/flujo-etapa1.mjs        # recorrido completo contra la API (base recién cargada)
node test/flujo-avance.mjs        # avance entre etapas (correr después del anterior)
```

`flujo-etapa1.mjs` recorre el proceso completo: login, correo de presentación,
respuestas, recordatorio, solicitud con adjunto, carga de nóminas con errores,
invitación y generación de Id, datos de contacto, webhook de rebote, dashboard
y cambio de etapa. `flujo-avance.mjs` sigue desde ahí: marcar según la
invitación, confirmar, deshacer, avisos solo a los no avisados, requisitos,
recordatorio a quienes les faltan documentos, alerta del dashboard, informe por
liceo y agregar/editar/eliminar etapas.

## Producción

- Definir `ADMIN_EMAIL` / `ADMIN_PASSWORD` para crear el primer usuario (no
  cargar `02_datos_demo.sql`).
- Configurar el SMTP del proveedor (`SMTP_*`) y el webhook de eventos con
  `MAIL_WEBHOOK_TOKEN`.
- `JWT_SECRET` largo y aleatorio. Servir detrás de HTTPS.
- Respaldar la base y la carpeta `UPLOAD_DIR` (adjuntos).
- El esquema funciona en PostgreSQL 11 o superior (probado en 16). El informe
  del equipo anterior menciona PostgreSQL 10 en el servidor del cliente: en esa
  versión los triggers deben escribirse `EXECUTE PROCEDURE` en vez de
  `EXECUTE FUNCTION`. Confirmar la versión con `SELECT version();` antes de desplegar.

## Pendiente (siguientes etapas)

- Datos de la etapa de postulación por estudiante: % RSH, tramo, personas con
  invalidez o que requieren apoyo, y comparación de integrantes del hogar
  (formulario vs. RSH) — a la espera de definir el detalle con la fundación
- Posible etapa adicional entre la 2 y la 3 (el sistema ya permite insertarla)

- Carga del Excel de puntajes y vista del ranking (Preselección N°1)
- Cortes del ranking, entrevistas con la pauta de entrevista y selección final
- Aceptación del liceo para los seleccionados
