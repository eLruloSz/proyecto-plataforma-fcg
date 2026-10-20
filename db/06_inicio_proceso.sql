-- ============================================================================
-- Migración 06 — Inicio de proceso y revisión de liceos
--
--  * Un proceso nuevo parte como BORRADOR: se revisan los liceos y sus
--    contactos, se eligen los que participan ese año y recién al confirmar
--    pasa a ACTIVO. Solo puede haber un proceso en BORRADOR o ACTIVO a la vez.
--  * Por cada liceo y proceso se guarda:
--      incluido    → si el liceo participa en ese proceso (desmarcarlo lo
--                    deja fuera solo ese año; para sacarlo para siempre se
--                    desactiva el liceo: liceos.activo = FALSE).
--      revisado_en → cuándo se revisaron sus datos al iniciar el proceso.
--
-- Base nueva: Docker la ejecuta sola después de 01 a 05.
-- Base existente:
--   docker exec -i becas-db psql -U becas -d becas < db/06_inicio_proceso.sql
-- ============================================================================

BEGIN;

ALTER TABLE participaciones_liceo ADD COLUMN IF NOT EXISTS incluido BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE participaciones_liceo ADD COLUMN IF NOT EXISTS revisado_en TIMESTAMPTZ;
ALTER TABLE participaciones_liceo ADD COLUMN IF NOT EXISTS revisado_por UUID REFERENCES usuarios(id);

-- Un solo proceso en preparación o en curso a la vez
CREATE UNIQUE INDEX IF NOT EXISTS ux_proceso_en_curso ON procesos ((TRUE)) WHERE estado IN ('BORRADOR', 'ACTIVO');

COMMIT;