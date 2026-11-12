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
docker exec -i becas-db psql -U becas -d becas < db/11_usuarios_acceso.sql
```

En **Windows PowerShell** el `<` no funciona; usa:

```powershell
Get-Content db\11_usuarios_acceso.sql -Raw | docker exec -i becas-db psql -U becas -d becas
```

Si una pantalla muestra «Internal server error» justo después de actualizar el código, casi
siempre es una migración sin aplicar (el log dice `column ... does not exist` o
`relation ... does not exist`): `docker logs becas-backend --tail 40`.

| Migración | Qué agrega |
|---|---|
| `01_schema.sql` | Esquema base |
| `02_datos_demo.sql` | Datos de prueba (solo desarrollo) |
| `03_avance_etapas.sql` | Avance entre etapas, requisitos y cupos |
| `04_etapa_encuentro.sql` | Encuentro online ligado a la etapa 2 |
| `05_fase3_entrevistas.sql` | Entrevistas |
| `06_inicio_proceso.sql` | Inicio del proceso y revisión de liceos |
| `07_generaciones.sql` | Histórico de concursos anteriores |
| `08_preseleccion.sql` | Ficha RSH, ranking y hito "Aviso de resultados" |
| `09_calendario_entrevistas.sql` | Calendario de entrevistas |
| `10_hitos_por_etapa.sql` | Etapa a la que pertenece cada hito del seguimiento por liceo |
| `11_usuarios_acceso.sql` | Roles (equipo / solo lectura), invitaciones y "¿Olvidaste tu contraseña?" |
| `12_pautas_completadas.sql` | Word de la pauta de entrevista ya rellenado, guardado por estudiante y etapa |
| `13_plantilla_invitacion_lista.sql` | Plantilla «Invitación a postular (listado para la contraparte)»: solo los nombres de los invitados + enlace al formulario |
| `14_plantillas_anexo_2026.sql` | Etapa de cada plantilla y los 18 correos reales del proceso 2026 (contrapartes, directivos y postulantes) |
| `15_hitos_flujo_2026.sql` | Seguimiento por liceo según el flujo actual: hitos por etapa, casi todos automáticos, 2 calculados (respuestas de invitados, entrevista final) |

Para probar cargas: nóminas en `db/nominas-demo/` (el liceo 05 trae errores a propósito).
Para recorrer el proceso completo (27 liceos, etapas 1 a 5): `db/prueba-completa/` (ver su README y la guía Excel).

## Probar con un correo real

Por defecto los correos llegan a Mailpit y no salen a internet. Para ver cómo llegan de
verdad (en Gmail, Outlook, el celular):

1. Copia `.env.example` como `.env` (en la raíz; no se sube al repo) y completa `SMTP_*`
   con tu cuenta. Con Gmail se usa una *contraseña de aplicación*.
2. Deja **`MAIL_REDIRIGIR_A`** con tu correo: todos los envíos llegan a esa casilla, con el
   destinatario real en el asunto (`[Prueba — para: contraparte01@…]`). Así no se le escribe
   a ningún liceo ni estudiante aunque la base tenga contactos reales.
3. `docker compose --profile app up -d` (recrea el backend con las nuevas variables).

En producción `MAIL_REDIRIGIR_A` va vacío y `SMTP_*` apunta a la casilla de la fundación.

## Usuarios y acceso

- **No hay registro abierto.** En producción el primer usuario se crea solo al arrancar si
  la base no tiene usuarios y están definidas `ADMIN_EMAIL` / `ADMIN_PASSWORD`. Desde ahí,
  las demás cuentas se crean en **Usuarios** (abajo en el menú): se invita por correo y la
  persona crea su contraseña con el enlace (vence en 48 horas, sirve una vez).
- **Roles:** *Equipo* (trabaja el proceso, puede invitar usuarios) y *Solo lectura* (ve todo,
  no modifica nada; pensado para el director de la fundación). El backend bloquea cualquier
  cambio de una cuenta de solo lectura, no solo la interfaz.
- **¿Olvidaste tu contraseña?** en el login manda un enlace que vence en 1 hora. La respuesta
  es la misma exista o no el correo. Desde **Usuarios** también se puede mandar ese enlace a
  otra persona.
- Cambiar o restablecer la contraseña, desactivar una cuenta o cambiarle el rol cierra las
  sesiones abiertas de esa persona.
- Los enlaces se arman con `APP_URL` (dirección del frontend). En desarrollo los correos
  llegan a Mailpit (<http://localhost:8025>).

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
5. **Etapas 4 y 5 · Entrevistas** (Preselección N°2 y Selección de becarios).
   - Calendario semanal con los mismos estados y colores de la planilla de la fundación,
     días u horarios bloqueados y comentarios.
   - En *Avance por etapa* cada estudiante tiene si la entrevista se hizo, fecha y hora y
     un comentario, con filtro «Sin entrevistar». Estos campos nunca se bloquean.
   - **Descargar Word:** la pauta de entrevista de la fundación, rellenada con los datos
     del estudiante (ver *Exportar y descargar*).
6. **Cerrar proceso** (en *Configurar etapas*). Queda guardado en *Generaciones
   anteriores* y vuelve a aparecer "Iniciar proceso" para el año siguiente.

En cada etapa, *Confirmar avance* aplica quién pasa y quién no. Una etapa ya terminada se
puede consultar con un clic en la barra, sin retroceder el proceso.

## Exportar y descargar

Cada tipo de documento tiene su color: **verde = Excel**, **azul = Word**.

- **Exportar a Excel** (botón verde, arriba en *Avance por etapa*). Está en todas las etapas,
  también al consultar una ya terminada. Trae los estudiantes de la etapa con los datos que se
  tienen *hasta* esa etapa (colegio → contacto y encuentro → ficha RSH y ranking → entrevistas)
  y las hojas del **Listado Final de Invitados** (*Invitados*, *Correos postulantes*, *Envíos y
  formulario con RSH*, *Postulantes por liceo*). Un dato que falta deja la celda vacía; una
  columna que nadie ha llenado no aparece. Del ranking solo se exporta la posición: el Excel
  de Puntajes es aparte y está pendiente.
- **Descargar Word** (botón azul, en *Entrevistas*). Abre una ventana con cada estudiante de la
  etapa y su botón «Descargar». Se puede buscar por nombre, código o liceo, filtrar por liceo,
  por datos faltantes o sin entrevista agendada, ordenar por fecha, ranking, liceo o apellido,
  y limitar por ranking. «Descargar todas» baja un .zip con las que se ven en la lista.
  - Se rellena con: código, nombre, liceo, comuna, posición en notas, ranking, fecha y hora de
    la entrevista, tramo RSH, personas del hogar e ingreso mensual.
  - Lo que el sistema no tiene queda en blanco y el Word se descarga igual: la ventana muestra
    qué le falta a cada estudiante y avisa al descargar. Una pauta ya descargada se puede
    volver a descargar.
  - **Subir el Word completado.** Después de la entrevista se sube el mismo Word, ya rellenado, en la
    ventana *Descargar Word* (botón «Subir completada»). Queda guardado en el estudiante de esa etapa:
    se puede descargar de nuevo, reemplazar o quitar. Si el archivo no trae el código del estudiante
    se avisa antes de guardarlo (evita subir la pauta de otra persona). En *Avance por etapa*, la
    columna *Entrevista* muestra «📄 Pauta» para quien la tiene, y también la pueden abrir las
    cuentas de *solo lectura* (pensado para quienes deciden en la selección final).
  - La plantilla vive dentro del código (`backend/src/entrevistas/plantilla-pauta.ts`, el
    Word en base64; las instrucciones para cambiarla están en ese archivo).
- Las cuentas de *solo lectura* también pueden exportar y descargar.

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

- **Página de Selección de becarios** (la última etapa): comparar a los entrevistados, guardar
  la apreciación general de la entrevista (aceptaría / con dudas / no aceptaría), el cupo y
  la decisión del Comité.
- Aceptación del liceo para los seleccionados.
- Importar el cuestionario de la etapa 3 (personas del hogar según el formulario) y, con eso,
  el Excel de Puntajes (se coordina con quien hace el RSH y el ranking).
- **Pruebas automáticas** de la exportación a Excel y de la pauta en Word (hoy no tienen).
- Reuniones virtuales por Teams (registro automático de asistencia): fuera por ahora.
- Definir con la fundación qué hacer con los datos de los postulantes no seleccionados.