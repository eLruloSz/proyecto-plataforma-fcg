-- ============================================================================
-- Migración 08 — Preselección N°1: ficha de postulación y ranking
--
--  * La etapa "Preselección N°1" se marca con la clave 'PRESELECCION' para que
--    el frontend muestre ahí la ficha y el ranking (igual que 'ENCUENTRO' y
--    'ENTREVISTA').
--  * Ficha de postulación: datos que la fundación digita mirando la cartola del
--    Registro Social de Hogares (RSH) que envía el estudiante. La cartola NO se
--    guarda en el sistema; solo estos números.
--  * Ranking: el Excel que calcula la fundación se sube tal cual. Se guarda una
--    fila por estudiante (cruzada por el Id, ej. "16.054a") con sus puntajes;
--    una carga nueva reemplaza a la anterior.
--  * Hito nuevo por liceo: "Aviso de resultados" (se marca solo al enviar el
--    informe de estudiantes a la contraparte).
--
-- Base nueva: Docker la ejecuta sola después de 01 a 07.
-- Base existente:
--   docker exec -i becas-db psql -U becas -d becas < db/08_preseleccion.sql
-- ============================================================================

BEGIN;

UPDATE etapas e SET clave = 'PRESELECCION'
 WHERE e.nombre ILIKE 'Preselección N°1'
   AND e.clave IS NULL
   AND NOT EXISTS (SELECT 1 FROM etapas x WHERE x.proceso_id = e.proceso_id AND x.clave = 'PRESELECCION' AND x.id <> e.id);

-- ---------------------------------------------------------------------------
-- Ficha de postulación (una por estudiante)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fichas_postulacion (
  postulacion_id       UUID PRIMARY KEY REFERENCES postulaciones(id) ON DELETE CASCADE,
  -- Tramo del RSH: 40 = "0% al 40%", 50 = "41% al 50%"… NULL = sin dato
  tramo_rsh            SMALLINT CHECK (tramo_rsh IN (40, 50, 60, 70, 80, 90, 100)),
  rsh_pendiente        BOOLEAN NOT NULL DEFAULT FALSE,     -- la "P" del Excel de ranking
  rsh_actualizada      DATE,                               -- "Última actualización de información"
  -- Personas del hogar según la cartola
  personas_hogar       SMALLINT CHECK (personas_hogar BETWEEN 1 AND 30),
  menores_18           SMALLINT CHECK (menores_18 BETWEEN 0 AND 30),
  mayores_60           SMALLINT CHECK (mayores_60 BETWEEN 0 AND 30),
  -- Personas del hogar con…
  con_discapacidad     SMALLINT CHECK (con_discapacidad BETWEEN 0 AND 30),
  con_dependencia      SMALLINT CHECK (con_dependencia BETWEEN 0 AND 30),
  con_invalidez        SMALLINT CHECK (con_invalidez BETWEEN 0 AND 30),
  con_nee              SMALLINT CHECK (con_nee BETWEEN 0 AND 30),      -- necesidades educativas especiales
  ingresos_hogar       VARCHAR(120),                       -- tal como lo dice la cartola: "Entre $X y $Y"
  -- Lo que declaró el estudiante en el formulario, para comparar con la cartola
  personas_formulario  SMALLINT CHECK (personas_formulario BETWEEN 1 AND 30),
  observaciones        TEXT,
  actualizado_por      UUID REFERENCES usuarios(id),
  actualizado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS tg_fichas_ts ON fichas_postulacion;
CREATE TRIGGER tg_fichas_ts BEFORE UPDATE ON fichas_postulacion
  FOR EACH ROW EXECUTE FUNCTION fn_actualizar_timestamp();

-- ---------------------------------------------------------------------------
-- Ranking (filas del Excel calculado por la fundación)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ranking_postulacion (
  carga_id             UUID NOT NULL REFERENCES cargas(id) ON DELETE CASCADE,
  postulacion_id       UUID NOT NULL REFERENCES postulaciones(id) ON DELETE CASCADE,
  posicion             INTEGER,                 -- "Ranking" general
  puntaje_total        NUMERIC(6,2),
  puntaje_academico    NUMERIC(6,2),
  puntaje_socioeconomico NUMERIC(6,2),
  puntaje_compromiso   NUMERIC(6,2),
  finalista            BOOLEAN NOT NULL DEFAULT FALSE,
  rsh                  VARCHAR(20),             -- "40%", "P"…
  datos                JSONB NOT NULL DEFAULT '{}'::jsonb,   -- la fila completa, por si se necesita otra columna
  PRIMARY KEY (carga_id, postulacion_id)
);
CREATE INDEX IF NOT EXISTS ix_ranking_postulacion ON ranking_postulacion (postulacion_id);

-- ---------------------------------------------------------------------------
-- Hito "Aviso de resultados" en el seguimiento por liceo
-- ---------------------------------------------------------------------------
INSERT INTO catalogo_hitos (codigo, nombre, orden)
VALUES ('AVISO_RESULTADOS', 'Aviso de resultados al liceo', 13)
ON CONFLICT (codigo) DO NOTHING;

COMMIT;