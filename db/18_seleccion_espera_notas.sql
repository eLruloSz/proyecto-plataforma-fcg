-- ============================================================================
-- Migración 18 — Selección final: lista de espera y notas del comité
--
--  * "En espera": quien no entra en el cupo pero podría entrar si alguien rechaza. No es un resultado de
--    la etapa (eso sigue siendo pasa / no pasa): es solo una marca de esta pantalla. El puesto en la lista
--    sale del ranking (el mejor ranking va primero), no se guarda.
--  * "Notas del comité": por qué se decidió así. Una por estudiante.
--
-- Es seguro correrla más de una vez.
-- Base nueva: Docker la ejecuta sola después de 01 a 17.
-- Base existente (PowerShell):
--   Get-Content db\18_seleccion_espera_notas.sql -Raw | docker exec -i becas-db psql -U becas -d becas
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS seleccion_extra (
  postulacion_id  UUID NOT NULL REFERENCES postulaciones(id) ON DELETE CASCADE,
  etapa_id        UUID NOT NULL REFERENCES etapas(id) ON DELETE CASCADE,
  en_espera       BOOLEAN NOT NULL DEFAULT FALSE,
  notas           TEXT,
  actualizado_por UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (postulacion_id, etapa_id)
);

COMMIT;
