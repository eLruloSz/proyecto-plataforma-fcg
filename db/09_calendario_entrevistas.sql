-- ============================================================================
-- Migración 09 — Calendario de entrevistas (Preselección N°2 y Selección)
--
--  * Cada entrevista tiene un estado, con los mismos nombres y colores que usa
--    la fundación en su planilla:
--      POR_SOLICITAR (amarillo) · SOLICITADA (naranjo) · CONFIRMADA (verde,
--      "visita confirmada") · REALIZADA (azul) · CANCELADA (gris) ·
--      CONFLICTO (morado, "conflicto de horario").
--    La columna `realizada` (migración 05) se mantiene y queda sincronizada:
--    realizada = (estado = 'REALIZADA').
--  * Bloques horarios de cada etapa de entrevistas (por defecto 10, 11 y 12 hrs).
--  * Bloqueos de agenda: un día completo o un bloque (ej. "Directorio",
--    feriado). Fecha y hora "de reloj" (sin zona horaria).
--
-- Base nueva: Docker la ejecuta sola después de 01 a 08.
-- Base existente:
--   docker exec -i becas-db psql -U becas -d becas < db/09_calendario_entrevistas.sql
-- ============================================================================

BEGIN;

ALTER TABLE entrevistas ADD COLUMN IF NOT EXISTS estado VARCHAR(20);
UPDATE entrevistas SET estado = CASE WHEN realizada THEN 'REALIZADA'
                                     WHEN fecha_hora IS NOT NULL THEN 'CONFIRMADA'
                                     ELSE 'POR_SOLICITAR' END
 WHERE estado IS NULL;
ALTER TABLE entrevistas ALTER COLUMN estado SET DEFAULT 'POR_SOLICITAR';
ALTER TABLE entrevistas ALTER COLUMN estado SET NOT NULL;
ALTER TABLE entrevistas DROP CONSTRAINT IF EXISTS entrevistas_estado_check;
ALTER TABLE entrevistas ADD CONSTRAINT entrevistas_estado_check CHECK (estado IN (
  'POR_SOLICITAR', 'SOLICITADA', 'CONFIRMADA', 'REALIZADA', 'CANCELADA', 'CONFLICTO'));

-- Bloques horarios de la etapa ("HH:MM"), editables desde el calendario
ALTER TABLE etapas ADD COLUMN IF NOT EXISTS horas_entrevista VARCHAR(5)[] NOT NULL DEFAULT '{10:00,11:00,12:00}';

CREATE TABLE IF NOT EXISTS bloqueos_agenda (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  etapa_id    UUID NOT NULL REFERENCES etapas(id) ON DELETE CASCADE,
  fecha       DATE NOT NULL,
  hora        VARCHAR(5),                 -- NULL = todo el día
  motivo      VARCHAR(150) NOT NULL,
  creado_por  UUID REFERENCES usuarios(id),
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_bloqueo_agenda ON bloqueos_agenda (etapa_id, fecha, COALESCE(hora, ''));

COMMIT;