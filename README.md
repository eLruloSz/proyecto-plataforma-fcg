# Sistema de gestión — Beca Carmen Goudie

Plataforma para la Fundación Carmen Goudie: acompaña el proceso anual de selección de
becarios, desde la invitación a los liceos hasta las entrevistas finales.

| Carpeta | Contenido |
|---|---|
| `backend/` | API en NestJS (TypeScript) |
| `frontend/` | Interfaz en React + Vite + Tailwind |
| `db/` | Esquema, migraciones, datos de prueba y nóminas de ejemplo |
| `scripts/` | Generador de nóminas de prueba |

## Levantar el sistema

Requisito: Docker.

```bash
docker compose --profile app up -d --build
```

- Sistema: <http://localhost:8080>
- Usuarios de prueba: `coordinacion@fcg.cl` y `direccion@fcg.cl`, contraseña `Demo1234!`
- Correos: **no salen a internet**, llegan a Mailpit en <http://localhost:8025>

**Base desde cero** (borra todo y vuelve a cargar los datos de prueba):

```bash
docker compose --profile app down -v && docker compose --profile app up -d --build
```

**Actualizar una base que ya tienes** (sin borrar datos): aplica en orden las migraciones
que le falten. Todas se pueden aplicar más de una vez sin problema.

```bash
docker exec -i becas-db psql -U becas -d becas < db/09_calendario_entrevistas.sql
```

| Migración | Qué agrega |
|---|---|
| `01_schema.sql` | Esquema base |
| `02_datos_demo.sql` | Datos de prueba (solo desarrollo) |
| `03_avance_etapas.sql` | Avance entre etapas, requisitos y cupos |
| `04_etapa_encuentro.sql` | Encuentro online ligado a la etapa 2 |
| `05_fase3_entrevistas.sql` | Entrevistas |
| `06_inicio_proceso.sql` | Inicio del proceso y revisión de liceos |
| `07_generaciones.sql` | Histórico de generaciones |
| `08_preseleccion.sql` | Ficha RSH, ranking y hito "Aviso de resultados" |
| `09_calendario_entrevistas.sql` | Calendario de entrevistas |

Para probar cargas: nóminas en `db/nominas-demo/` (el liceo 05 trae errores a propósito).

## Cómo se usa

El sistema se recorre etapa por etapa. La barra de arriba muestra en qué etapa va el
proceso y el **menú muestra solo lo que se trabaja en esa etapa**. El **Inicio** lista
las tareas de la etapa con un botón para ir a hacer cada una y, cuando están listas,
ofrece pasar a la siguiente.

1. **Iniciar proceso.** Se revisan los liceos y sus contactos, se eligen los que
   participan ese año y se confirma.
2. **Etapa 1 · Invitación a establecimientos.**
   - Correos a los liceos: presentación, solicitud de notas y aprobación de invitados.
   - Subir la nómina de cada liceo e invitar a los mejores promedios. Se pueden elegir
     los N primeros del liceo o de cada curso.
   - Cargar email, teléfono y RUT de los invitados con el Excel de respuestas de
     Microsoft Forms.
   - Seguimiento por liceo con hitos que se marcan solos.
3. **Etapa 2 · Presentación de la beca.** Fechas del encuentro online, inscripción de cada
   estudiante y asistencia.
4. **Etapa 3 · Preselección N°1.**
   - Documentos recibidos.
   - Ficha RSH: datos de la cartola, con alertas de tramo y de diferencia de personas
     del hogar. La cartola no se guarda.
   - Subir el Excel del ranking y marcar quién avanza según el ranking.
5. **Etapas 4 y 5 · Entrevistas.** Calendario semanal con los mismos estados y colores de
   la planilla de la fundación, días u horarios bloqueados y comentarios.
6. **Cerrar proceso** (en *Configurar etapas*). Queda guardado en *Generaciones
   anteriores* y vuelve a aparecer "Iniciar proceso" para el año siguiente.

En cada etapa, *Confirmar avance* aplica quién pasa y quién no. Una etapa ya terminada se
puede consultar con un clic en la barra, sin retroceder el proceso.

## Pruebas

Requieren Node.js 20 y `psql`. Con el sistema levantado y la base recién cargada:

```bash
cd backend && npm install
npm test                                                              # lector de nóminas
API=http://localhost:8080/api MAIL_WEBHOOK_TOKEN=token-de-desarrollo node test/flujo-etapa1.mjs
API=http://localhost:8080/api node test/flujo-avance.mjs
API=http://localhost:8080/api node test/flujo-generaciones.mjs       # al final: cierra el proceso
```

## Para producción

- No cargar `02_datos_demo.sql`. El primer usuario se crea con `ADMIN_EMAIL` y
  `ADMIN_PASSWORD`.
- Configurar el correo real (`SMTP_*`) y un `JWT_SECRET` largo y aleatorio.
- Respaldar la base y la carpeta de adjuntos.

## Pendiente

- Importar el cuestionario de la etapa 3 (personas del hogar según el formulario).
- Pauta de entrevista, si la fundación la quiere en el sistema.
- Aceptación del liceo para los seleccionados.
- Definir con la fundación qué hacer con los datos de los postulantes no seleccionados.