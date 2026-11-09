-- ============================================================================
-- Migración 13 — Plantilla de invitación a postular con el listado de estudiantes
--
--  * Correo a la contraparte de cada liceo con SOLO los nombres de sus estudiantes
--    invitados ({{lista_estudiantes}}: sin Id ni etapa) y el enlace al formulario
--    para que respondan si van a participar.
--  * Solo agrega la plantilla si no existe una con el mismo nombre; no toca las demás.
--
-- Base nueva: Docker la ejecuta sola después de 01 a 12.
-- Base existente:
--   docker exec -i becas-db psql -U becas -d becas < db/13_plantilla_invitacion_lista.sql
-- ============================================================================

BEGIN;

INSERT INTO plantillas_correo (nombre, proposito, asunto, cuerpo)
SELECT * FROM (VALUES
  ('Invitación a postular (listado para la contraparte)', 'INVITACION_ESTUDIANTES',
   'Beca Carmen Goudie {{anio}} — Estudiantes de {{liceo}} invitados a postular',
   E'Estimado/a {{nombre}}:\n\nLe compartimos el listado de estudiantes de {{liceo}} que han sido invitados a postular a la Beca Carmen Goudie {{anio}}:\n\n{{lista_estudiantes}}\n\nLe pedimos hacerles llegar el siguiente formulario, donde cada estudiante debe responder si participará en el proceso:\n\n[pega aquí el enlace al formulario]\n\nSaludos cordiales,\n{{firma}}')
) AS v(nombre, proposito, asunto, cuerpo)
WHERE NOT EXISTS (SELECT 1 FROM plantillas_correo p WHERE p.nombre = v.nombre);

COMMIT;
