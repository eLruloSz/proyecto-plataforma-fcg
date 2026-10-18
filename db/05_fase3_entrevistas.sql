-- ============================================================================
-- Migración 05 — Fase 3: Entrevistas (Preselección N°2 y Selección de Becarios)
--
--  * Ambas etapas de la Fase 3 son solo de entrevistas (presenciales en
--    Preselección N°2, de comité en Selección de Becarios). Se marcan con la
--    clave 'ENTREVISTA' para que el frontend sepa cuándo mostrar esas
--    columnas, igual que ya se hace con 'ENCUENTRO' (migración 04).
--  * No se agrega nada de RSH ni ranking aquí: eso es de otra etapa
--    (Preselección N°1) y de otra parte del equipo.
--  * Una fila en "entrevistas" = la entrevista de un postulante en una etapa
--    puntual. Si Preselección N°2 y Selección de Becarios son etapas
--    distintas, cada una lleva su propio registro (incluye su propia fecha,
--    si fue realizada y su comentario).
--  * Nada queda bloqueado: no hay ninguna restricción que impida editar
--    datos de etapas anteriores aunque el proceso ya haya avanzado.
--
-- Base nueva: Docker la ejecuta sola después de 01, 02, 03 y 04.
-- Base existente:
--   docker exec -i becas-db psql -U becas -d becas < db/05_fase3_entrevistas.sql
-- ============================================================================

BEGIN;

UPDATE etapas e SET clave = 'ENTREVISTA'
 WHERE e.nombre ILIKE 'Preselección N°2'
   AND e.clave IS NULL
   AND NOT EXISTS (SELECT 1 FROM etapas x WHERE x.proceso_id = e.proceso_id AND x.clave = 'ENTREVISTA' AND x.id <> e.id);

UPDATE etapas e SET clave = 'ENTREVISTA_COMITE'
 WHERE e.nombre ILIKE 'Selección de becarios'
   AND e.clave IS NULL
   AND NOT EXISTS (SELECT 1 FROM etapas x WHERE x.proceso_id = e.proceso_id AND x.clave = 'ENTREVISTA_COMITE' AND x.id <> e.id);

CREATE TABLE IF NOT EXISTS entrevistas (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  postulacion_id   UUID NOT NULL REFERENCES postulaciones(id) ON DELETE CASCADE,
  etapa_id         UUID NOT NULL REFERENCES etapas(id) ON DELETE CASCADE,
  realizada        BOOLEAN NOT NULL DEFAULT FALSE,
  fecha_hora       TIMESTAMPTZ,
  comentario       TEXT,
  marcado_por      UUID REFERENCES usuarios(id),
  actualizado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ux_entrevista UNIQUE (postulacion_id, etapa_id)
);
CREATE INDEX IF NOT EXISTS ix_entrevistas_etapa ON entrevistas (etapa_id, fecha_hora);
CREATE TRIGGER tg_entrevistas_ts BEFORE UPDATE ON entrevistas
  FOR EACH ROW EXECUTE FUNCTION fn_actualizar_timestamp();

COMMIT;