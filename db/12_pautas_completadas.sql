-- ============================================================================
-- Migración 12 — Pauta de entrevista completada (Word)
--
--  * Después de la entrevista, la fundación sube el Word de la pauta ya rellenado.
--    Queda guardado como dato del estudiante en esa etapa, para que la dirección
--    lo lea al decidir quién recibe la beca.
--  * Un Word por estudiante y etapa de entrevista: si se sube otro, reemplaza al anterior.
--  * El archivo vive en disco (tabla `archivos`); aquí solo queda la referencia.
--
-- Base nueva: Docker la ejecuta sola después de 01 a 11.
-- Base existente:
--   docker exec -i becas-db psql -U becas -d becas < db/12_pautas_completadas.sql
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS pautas_entrevista (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  postulacion_id  UUID NOT NULL REFERENCES postulaciones(id) ON DELETE CASCADE,
  etapa_id        UUID NOT NULL REFERENCES etapas(id) ON DELETE CASCADE,
  archivo_id      UUID NOT NULL REFERENCES archivos(id) ON DELETE CASCADE,
  subido_por      UUID REFERENCES usuarios(id),
  subido_en       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ux_pauta_entrevista UNIQUE (postulacion_id, etapa_id)
);
CREATE INDEX IF NOT EXISTS ix_pautas_entrevista_etapa ON pautas_entrevista (etapa_id);

COMMIT;
