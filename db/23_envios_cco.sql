-- ============================================================================
-- Migración 23 — Copia oculta (CCO) en los correos
--
--  * envios.cco: correos que reciben copia oculta de cada correo del envío.
--    Los destinatarios no ven estas direcciones.
--  * La copia "normal" (envios.cc) queda siempre en CC de cada correo; el modo
--    RESUMEN se deja de ofrecer en la pantalla (los envíos antiguos lo conservan).
--
-- Es segura de correr más de una vez.
-- Base existente (PowerShell):
--   Get-Content db\23_envios_cco.sql -Raw | docker exec -i becas-db psql -U becas -d becas
-- ============================================================================

BEGIN;

ALTER TABLE envios ADD COLUMN IF NOT EXISTS cco TEXT[] NOT NULL DEFAULT '{}';

COMMIT;
