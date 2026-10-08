# Sistema de gestión — Beca Carmen Goudie

Plataforma para la Fundación Carmen Goudie: gestiona la invitación a liceos, la
recepción de nóminas de notas, la selección de invitados y la comunicación por
correo del proceso de selección de becarios.

**Estado:** etapa 1 (Invitación a establecimientos) completa de punta a punta.

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

**Volver a cargar la base desde cero** (borra todo): `docker compose down -v && docker compose up -d`.

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
```

`flujo-etapa1.mjs` recorre el proceso completo: login, correo de presentación,
respuestas, recordatorio, solicitud con adjunto, carga de nóminas con errores,
invitación y generación de Id, datos de contacto, webhook de rebote, dashboard
y cambio de etapa.

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

- Carga del Excel de puntajes y vista del ranking (Preselección N°1)
- Cortes del ranking, entrevistas con la pauta de entrevista y selección final
- Aceptación del liceo para los seleccionados
