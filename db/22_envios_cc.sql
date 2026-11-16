-- ============================================================================
-- Migración 22 — Copia (CC) de los correos al resto del equipo
--
--  * envios.cc: correos que reciben copia de este envío (por defecto, los demás
--    usuarios del equipo, para que todos estén enterados).
--  * envios.cc_modo:
--      CADA    → van en CC de cada correo (si el envío es a 27 liceos, reciben 27 copias)
--      RESUMEN → reciben UNA sola copia: el texto del correo y la lista de a quién se envió
--
-- Es segura de correr más de una vez.
-- Base existente (PowerShell):
--   Get-Content db\22_envios_cc.sql -Raw | docker exec -i becas-db psql -U becas -d becas
-- ============================================================================

BEGIN;

ALTER TABLE envios ADD COLUMN IF NOT EXISTS cc TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE envios ADD COLUMN IF NOT EXISTS cc_modo VARCHAR(10) NOT NULL DEFAULT 'CADA';
ALTER TABLE envios DROP CONSTRAINT IF EXISTS envios_cc_modo_check;
ALTER TABLE envios ADD CONSTRAINT envios_cc_modo_check CHECK (cc_modo IN ('CADA', 'RESUMEN'));

COMMIT;
