-- ============================================================================
-- Migración 19 — Correos a los directivos de la fundación
--
--  * Nuevo grupo de destinatarios DIRECTIVOS (las cuentas de solo lectura activas, más los correos que se
--    escriban a mano) y nuevo tipo de correo INFORME_DIRECTIVOS.
--  * Plantilla lista para enviar el Excel de la selección final.
--
-- Es seguro correrla más de una vez.
-- Base existente (PowerShell):
--   Get-Content db\19_envios_directivos.sql -Raw | docker exec -i becas-db psql -U becas -d becas
-- ============================================================================

BEGIN;

DO $$
DECLARE c TEXT;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'envios'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%grupo%'
  LOOP
    EXECUTE format('ALTER TABLE envios DROP CONSTRAINT %I', c);
  END LOOP;
END $$;
ALTER TABLE envios ADD CONSTRAINT envios_grupo_check
  CHECK (grupo IN ('CONTRAPARTES', 'DIRECTORES', 'LICEO', 'POSTULANTES', 'DIRECTIVOS'));

ALTER TABLE plantillas_correo DROP CONSTRAINT IF EXISTS plantillas_correo_proposito_check;
ALTER TABLE plantillas_correo ADD CONSTRAINT plantillas_correo_proposito_check CHECK (proposito IN (
  'PRESENTACION', 'SOLICITUD_NOTAS', 'SOLICITUD_CONTACTOS', 'INVITACION_ESTUDIANTES',
  'AVISO_RESULTADO', 'AGRADECIMIENTO', 'INFORME_LICEO', 'INFORME_DIRECTIVOS', 'OTRO'));

INSERT INTO plantillas_correo (etapa_orden, nombre, proposito, asunto, cuerpo)
SELECT * FROM (VALUES
  (5::smallint, 'Resumen de la selección final para la dirección', 'INFORME_DIRECTIVOS',
   'Beca Carmen Goudie {{anio}} — Finalistas para la selección final',
   E'Estimado/a {{nombre}}:\n\nJunto con saludar, le compartimos el resumen de los finalistas de la Beca Carmen Goudie {{anio}} para la decisión final.\n\nEn el Excel adjunto encontrará, por cada finalista, su posición en el ranking, promedio, tramo del Registro Social de Hogares, apreciación de la entrevista, observaciones y la decisión que llevamos hasta ahora.\n\nQuedamos atentos a sus comentarios.\n\nSaludos cordiales,\n{{firma}}')
) AS v(etapa_orden, nombre, proposito, asunto, cuerpo)
WHERE NOT EXISTS (SELECT 1 FROM plantillas_correo p WHERE p.nombre = v.nombre);

COMMIT;
