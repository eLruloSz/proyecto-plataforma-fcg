-- ============================================================================
-- Migración 16 — Apreciación de la entrevista (para la selección final)
--
--  * Después de cada entrevista se anota una apreciación general:
--      ACEPTARIA · ACEPTARIA_CON_DUDAS · NO_ACEPTARIA
--    más las observaciones de quien entrevistó. Queda en la entrevista (una por
--    estudiante y etapa), junto a la fecha y el Word de la pauta completada.
--  * La pantalla "Selección final" la usa para sugerir pasa / no pasa a quienes
--    deciden. Es solo una sugerencia: la decisión sigue siendo de la fundación.
--
-- Es seguro correrla más de una vez.
-- Base nueva: Docker la ejecuta sola después de 01 a 15.
-- Base existente (PowerShell):
--   Get-Content db\16_apreciacion_entrevista.sql -Raw | docker exec -i becas-db psql -U becas -d becas
-- ============================================================================

BEGIN;

ALTER TABLE entrevistas ADD COLUMN IF NOT EXISTS apreciacion VARCHAR(25);
ALTER TABLE entrevistas ADD COLUMN IF NOT EXISTS apreciacion_observaciones TEXT;
ALTER TABLE entrevistas ADD COLUMN IF NOT EXISTS apreciacion_por UUID REFERENCES usuarios(id);
ALTER TABLE entrevistas ADD COLUMN IF NOT EXISTS apreciacion_en TIMESTAMPTZ;

ALTER TABLE entrevistas DROP CONSTRAINT IF EXISTS entrevistas_apreciacion_check;
ALTER TABLE entrevistas ADD CONSTRAINT entrevistas_apreciacion_check
  CHECK (apreciacion IS NULL OR apreciacion IN ('ACEPTARIA', 'ACEPTARIA_CON_DUDAS', 'NO_ACEPTARIA'));

COMMIT;
