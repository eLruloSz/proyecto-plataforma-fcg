-- ============================================================================
-- Migración 21 — Logo de la firma de los correos
--
--  * Tabla configuracion: ajustes generales del sistema (uno por clave).
--  * Clave LOGO_FIRMA: logo que va al final de todos los correos, debajo de la
--    firma de texto. Sin fila = se usa el logo incluido en el sistema
--    (backend/assets/logo-firma.png); archivo_id = logo subido desde Mi perfil;
--    valor 'NINGUNO' = los correos salen sin logo.
--
-- Es segura de correr más de una vez.
-- Base existente (PowerShell):
--   Get-Content db\21_logo_firma.sql -Raw | docker exec -i becas-db psql -U becas -d becas
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS configuracion (
  clave            VARCHAR(50) PRIMARY KEY,
  valor            TEXT,
  archivo_id       UUID REFERENCES archivos(id) ON DELETE SET NULL,
  actualizado_por  UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  actualizado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMIT;
