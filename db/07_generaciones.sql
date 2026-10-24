-- ============================================================================
-- Migración 07 — Histórico de generaciones
--
--  * Al cerrar un proceso se guarda un RESUMEN (foto de ese momento) con el
--    embudo, los resultados por liceo, los becarios y el material del año.
--    Las tarjetas de "Generaciones" y su detalle se leen de ese resumen, así
--    que no cambian aunque después se editen liceos o contactos.
--  * Un proceso CERRADO no se puede reabrir: solo se consulta.
--  * Generaciones históricas "livianas": años anteriores al sistema, de los
--    que solo se ingresan a mano los números del embudo y los becarios.
--    Son procesos CERRADOS con historico = TRUE y sin etapas ni estudiantes.
--
-- Base nueva: Docker la ejecuta sola después de 01 a 06.
-- Base existente:
--   docker exec -i becas-db psql -U becas -d becas < db/07_generaciones.sql
-- ============================================================================

BEGIN;

ALTER TABLE procesos ADD COLUMN IF NOT EXISTS historico BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE procesos ADD COLUMN IF NOT EXISTS cerrado_en TIMESTAMPTZ;
ALTER TABLE procesos ADD COLUMN IF NOT EXISTS resumen JSONB;
ALTER TABLE procesos ADD COLUMN IF NOT EXISTS observaciones TEXT;

-- Una generación histórica siempre está cerrada
ALTER TABLE procesos DROP CONSTRAINT IF EXISTS ck_procesos_historico;
ALTER TABLE procesos ADD CONSTRAINT ck_procesos_historico CHECK (NOT historico OR estado = 'CERRADO');

-- Procesos que ya estaban cerrados: la fecha de cierre más probable es la de
-- su última actualización. El resumen se calcula la primera vez que se consultan.
UPDATE procesos SET cerrado_en = actualizado_en WHERE estado = 'CERRADO' AND cerrado_en IS NULL;

COMMIT;
