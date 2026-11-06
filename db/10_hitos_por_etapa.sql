-- ============================================================================
-- 10. Hitos por etapa
--   Cada hito del seguimiento por liceo indica en qué tipo de etapa se trabaja,
--   para que el Inicio muestre solo los hitos de la etapa en curso.
--   Tipos (los mismos que usa el backend en tipoEtapa):
--     INVITACION, ENCUENTRO, PRESELECCION, ENTREVISTA, GENERAL
--   Un hito puede pertenecer a más de un tipo. Si se agrega un hito nuevo al
--   catálogo, basta con completar su columna tipos_etapa.
-- ============================================================================
BEGIN;

ALTER TABLE catalogo_hitos ADD COLUMN IF NOT EXISTS tipos_etapa VARCHAR(20)[] NOT NULL DEFAULT '{}';

UPDATE catalogo_hitos SET tipos_etapa = '{INVITACION}'
 WHERE codigo IN ('MAIL_PRESENTACION', 'ACUSO_RECIBO', 'MAIL_SOLICITUD_NOTAS', 'RECEPCION_NOMINA',
                  'DEFINICION_INVITADOS', 'MAIL_APROBACION', 'APROBACION_CONTACTOS',
                  'INVITACION_ESTUDIANTES', 'VISITA', 'MAIL_AGRADECIMIENTO', 'CIERRE_ETAPA_1');
UPDATE catalogo_hitos SET tipos_etapa = '{PRESELECCION}' WHERE codigo = 'NOTIF_PRESELECCION';
UPDATE catalogo_hitos SET tipos_etapa = '{PRESELECCION,ENTREVISTA}' WHERE codigo = 'AVISO_RESULTADOS';

COMMIT;
