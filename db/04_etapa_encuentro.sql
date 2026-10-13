-- ============================================================================
-- Migración 04 — Encuentro online ligado a su etapa
--
--  * Cada etapa puede tener una "clave" que la identifica para el sistema,
--    independiente del nombre (el nombre se puede editar sin romper nada).
--  * La etapa con clave 'ENCUENTRO' habilita el registro del encuentro
--    online y la asistencia: mientras esté PENDIENTE (gris) no se muestran
--    esas columnas; al activarla (amarillo) o cerrarla (verde) se habilitan.
--
-- Base nueva: Docker la ejecuta sola después de 01, 02 y 03.
-- Base existente:
--   docker exec -i becas-db psql -U becas -d becas < db/04_etapa_encuentro.sql
-- ============================================================================

BEGIN;

ALTER TABLE etapas ADD COLUMN IF NOT EXISTS clave VARCHAR(30);

-- Una misma clave no puede estar en dos etapas del mismo proceso
CREATE UNIQUE INDEX IF NOT EXISTS ux_etapas_clave ON etapas (proceso_id, clave) WHERE clave IS NOT NULL;

-- La etapa "Presentación de la beca" es la del encuentro online
UPDATE etapas e SET clave = 'ENCUENTRO'
 WHERE e.nombre ILIKE 'Presentación de la beca'
   AND e.clave IS NULL
   AND NOT EXISTS (SELECT 1 FROM etapas x WHERE x.proceso_id = e.proceso_id AND x.clave = 'ENCUENTRO');

COMMIT;
