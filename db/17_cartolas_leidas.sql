-- ============================================================================
-- Migración 17 — Registro de cartolas RSH leídas (sin guardar el PDF)
--
--  * La cartola (PDF) se lee en memoria, sus datos van a la ficha y el archivo se descarta.
--  * Aquí solo queda la HUELLA (hash SHA-256) del archivo y la fecha de emisión, para:
--      - detectar la misma cartola subida dos veces para un estudiante;
--      - poder comprobar después que un archivo concreto fue el que se cargó
--        (si alguien lo muestra, su huella coincide o no; de la huella no se puede recuperar el contenido).
--  * No se guarda ningún dato de los demás integrantes del hogar.
--
-- Es seguro correrla más de una vez.
-- Base nueva: Docker la ejecuta sola después de 01 a 16.
-- Base existente (PowerShell):
--   Get-Content db\17_cartolas_leidas.sql -Raw | docker exec -i becas-db psql -U becas -d becas
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS cartolas_leidas (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  postulacion_id  UUID NOT NULL REFERENCES postulaciones(id) ON DELETE CASCADE,
  hash_sha256     CHAR(64) NOT NULL,
  emitida_en      DATE,
  leida_por       UUID REFERENCES usuarios(id),
  leida_en        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ux_cartola_leida UNIQUE (postulacion_id, hash_sha256)
);
CREATE INDEX IF NOT EXISTS ix_cartolas_leidas_hash ON cartolas_leidas (hash_sha256);

COMMIT;
