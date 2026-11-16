-- ============================================================================
-- Migración 20 — Orden de las plantillas de correo
--
--  * plantillas_correo.orden: posición de la plantilla dentro de su etapa, en el
--    orden en que se envían los correos (1 = el primero de la etapa). La lista de
--    plantillas se muestra por etapa y, dentro de cada una, por este orden; las
--    plantillas sin etapa ("Otras plantillas") van al final.
--  * Desactiva (no borra) las plantillas antiguas que el flujo actual reemplazó,
--    para que no se confundan con las nuevas:
--      Presentación de la beca a liceos      → Inicio del proceso y solicitud de nómina
--      Solicitud de nómina de notas          → Inicio del proceso y solicitud de nómina
--      Aprobación de invitados y datos…      → Invitados y formulario de contacto
--      Invitación a postular (estudiantes)   → la contraparte reenvía el formulario
--      Invitación a postular (listado…)      → Invitados y formulario de contacto
--    Para recuperar una: UPDATE plantillas_correo SET activo = TRUE WHERE nombre = '…';
--
-- Requiere la 14 y la 19. Es seguro correrla más de una vez.
-- Base existente (PowerShell):
--   Get-Content db\20_orden_plantillas.sql -Raw | docker exec -i becas-db psql -U becas -d becas
-- ============================================================================

BEGIN;

ALTER TABLE plantillas_correo ADD COLUMN IF NOT EXISTS orden SMALLINT
  CHECK (orden IS NULL OR orden BETWEEN 1 AND 99);

UPDATE plantillas_correo p SET orden = v.orden
  FROM (VALUES
    -- Etapa 1 · Invitación a establecimientos
    ('Inicio del proceso y solicitud de nómina (contrapartes)',          1),
    ('Invitados y formulario de contacto (contrapartes)',                2),
    ('Etapa 1: elige la fecha del encuentro online (postulantes)',       3),
    -- Etapa 2 · Presentación de la beca
    ('Presentación realizada y fechas importantes (contrapartes)',       1),
    ('Instrucciones de postulación (postulantes)',                       2),
    -- Etapa 3 · Preselección N°1
    ('Resultado Preselección N°1 (contrapartes)',                        1),
    ('Preselección N°1: avanza a entrevista (postulantes)',              2),
    ('Preselección N°1: no avanza (postulantes)',                        3),
    -- Etapa 4 · Preselección N°2
    ('Resultado Preselección N°2 y entrevista final (contrapartes)',     1),
    ('Preselección N°2: avanza a la etapa final (postulantes)',          2),
    ('Preselección N°2: no avanza (postulantes)',                        3),
    -- Etapa 5 · Selección de becarios
    ('Coordinación entrevista virtual (contrapartes)',                   1),
    ('Resumen de la selección final para la dirección',                  2),
    ('Fecha de resultados finales (directivos)',                         3),
    ('Fecha de resultados finales (postulantes)',                        4),
    ('Resultado final del proceso (contrapartes)',                       5),
    ('Resultado final: becario/a (postulantes)',                         6),
    ('Resultado final: no seleccionado/a (postulantes)',                 7),
    ('Invitación ceremonia de bienvenida (contrapartes)',                8),
    -- Otras plantillas (sirven en cualquier etapa)
    ('Informe de estudiantes para la contraparte',                       1),
    ('Recordatorio: documentos pendientes',                              2),
    ('Aviso: avanzas a la siguiente etapa',                              3),
    ('Aviso: no continúas en el proceso',                                4),
    ('Agradecimiento a liceos',                                          5)
  ) AS v(nombre, orden)
 WHERE p.nombre = v.nombre AND p.orden IS NULL;

UPDATE plantillas_correo SET activo = FALSE
 WHERE activo AND nombre IN (
   'Presentación de la beca a liceos',
   'Solicitud de nómina de notas',
   'Aprobación de invitados y datos de contacto',
   'Invitación a postular (estudiantes)',
   'Invitación a postular (listado para la contraparte)');

COMMIT;
