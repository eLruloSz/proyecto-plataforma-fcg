-- ============================================================================
-- Migración 15 — Seguimiento por liceo según el flujo acordado para 2026+
--
--  * Catálogo de hitos por etapa, casi todo automático:
--      Etapa 1: Correo de inicio · Acuso de recibo · Nómina recibida · Invitados
--               definidos · Listado y formulario a la contraparte · Respuestas
--               de los invitados (calculado) · Visita al liceo (a mano)
--      Etapa 2: Presentación y fechas a la contraparte
--      Etapa 3: Resultado de la preselección enviado · Contraparte revisó
--      Etapa 4: Resultado de la etapa y propuesta de entrevista final
--      Etapa 5: Entrevista final coordinada (calculado) · Resultado final
--               enviado · Invitación a la ceremonia
--  * Los hitos que ya no aplican (aprobación de contactos por tabla, cierre de
--    etapa, etc.) se DESACTIVAN, no se borran: el seguimiento del concurso 2025
--    los sigue mostrando.
--  * catalogo_hitos.tipos_etapa ahora usa la CLAVE de la etapa cuando la tiene
--    (ENCUENTRO, PRESELECCION, ENTREVISTA, ENTREVISTA_COMITE); la etapa 1 sin
--    clave sigue siendo INVITACION.
--  * catalogo_hitos.calculado: el hito no se marca, se calcula con los datos
--    (respuestas de los invitados, entrevistas agendadas).
--  * plantillas_correo.hito_envio / hito_respuesta: qué hito marca enviar esa
--    plantilla y qué hito marca que la contraparte la responda (además del que
--    corresponde por el tipo de correo).
--
-- Requiere la 14. Base nueva: Docker la ejecuta sola después de 01 a 14.
-- Base existente:
--   docker exec -i becas-db psql -U becas -d becas < db/15_hitos_flujo_2026.sql
-- ============================================================================

BEGIN;

ALTER TABLE catalogo_hitos ADD COLUMN IF NOT EXISTS calculado BOOLEAN NOT NULL DEFAULT FALSE;

INSERT INTO catalogo_hitos (codigo, nombre, orden, tipos_etapa, calculado, activo) VALUES
  ('MAIL_PRESENTACION',       'Correo de inicio',                          1, '{INVITACION}',        FALSE, TRUE),
  ('ACUSO_RECIBO',            'Acuso de recibo',                           2, '{INVITACION}',        FALSE, TRUE),
  ('RECEPCION_NOMINA',        'Nómina recibida',                           3, '{INVITACION}',        FALSE, TRUE),
  ('DEFINICION_INVITADOS',    'Invitados definidos',                       4, '{INVITACION}',        FALSE, TRUE),
  ('INVITACION_ESTUDIANTES',  'Listado y formulario a la contraparte',     5, '{INVITACION}',        FALSE, TRUE),
  ('RESPUESTAS_INVITADOS',    'Respuestas de los invitados',               6, '{INVITACION}',        TRUE,  TRUE),
  ('VISITA',                  'Visita al liceo',                           7, '{INVITACION}',        FALSE, TRUE),
  ('FECHAS_ENCUENTRO',        'Presentación y fechas a la contraparte',    8, '{ENCUENTRO}',         FALSE, TRUE),
  ('RESULTADO_PRESELECCION_1','Resultado de la preselección enviado',      9, '{PRESELECCION}',      FALSE, TRUE),
  ('REVISION_CONTRAPARTE_1',  'Contraparte revisó el resultado',          10, '{PRESELECCION}',      FALSE, TRUE),
  ('RESULTADO_PRESELECCION_2','Resultado y propuesta de entrevista final', 11, '{ENTREVISTA}',        FALSE, TRUE),
  ('ENTREVISTA_FINAL',        'Entrevista final coordinada',              12, '{ENTREVISTA_COMITE}', TRUE,  TRUE),
  ('RESULTADO_FINAL',         'Resultado final enviado',                  13, '{ENTREVISTA_COMITE}', FALSE, TRUE),
  ('INVITACION_CEREMONIA',    'Invitación a la ceremonia',                14, '{ENTREVISTA_COMITE}', FALSE, TRUE)
ON CONFLICT (codigo) DO UPDATE SET
  nombre = EXCLUDED.nombre, orden = EXCLUDED.orden, tipos_etapa = EXCLUDED.tipos_etapa,
  calculado = EXCLUDED.calculado, activo = TRUE;

-- Ya no se usan en el flujo actual (se conservan para el histórico).
UPDATE catalogo_hitos SET activo = FALSE, orden = 100 + orden
 WHERE codigo IN ('MAIL_SOLICITUD_NOTAS', 'MAIL_APROBACION', 'APROBACION_CONTACTOS', 'MAIL_AGRADECIMIENTO',
                  'CIERRE_ETAPA_1', 'NOTIF_PRESELECCION', 'AVISO_RESULTADOS')
   AND activo;

-- Hito que marca cada plantilla al enviarse / al ser respondida por la contraparte.
ALTER TABLE plantillas_correo ADD COLUMN IF NOT EXISTS hito_envio VARCHAR(50) REFERENCES catalogo_hitos(codigo);
ALTER TABLE plantillas_correo ADD COLUMN IF NOT EXISTS hito_respuesta VARCHAR(50) REFERENCES catalogo_hitos(codigo);

UPDATE plantillas_correo p SET hito_envio = v.envio, hito_respuesta = v.respuesta
  FROM (VALUES
    ('Presentación realizada y fechas importantes (contrapartes)',    'FECHAS_ENCUENTRO',         NULL),
    ('Resultado Preselección N°1 (contrapartes)',                     'RESULTADO_PRESELECCION_1', 'REVISION_CONTRAPARTE_1'),
    ('Resultado Preselección N°2 y entrevista final (contrapartes)',  'RESULTADO_PRESELECCION_2', NULL),
    ('Resultado final del proceso (contrapartes)',                    'RESULTADO_FINAL',          NULL),
    ('Invitación ceremonia de bienvenida (contrapartes)',             'INVITACION_CEREMONIA',     NULL)
  ) AS v(nombre, envio, respuesta)
 WHERE p.nombre = v.nombre AND p.hito_envio IS NULL;

COMMIT;
