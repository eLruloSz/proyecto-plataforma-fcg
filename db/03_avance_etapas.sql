-- ============================================================================
-- Migración 03 — Avance por etapa
--
--  * Cada etapa tiene su propia configuración: cupo del corte y una lista de
--    requisitos (documentos o pasos) que se marcan por estudiante.
--  * Las etapas se pueden agregar, renombrar y reordenar (ej. una etapa nueva
--    entre la 2 y la 3).
--  * Cada estudiante está en una etapa (postulaciones.etapa_id). Para pasar a
--    la siguiente se marca "pasa" / "no pasa" y luego se CONFIRMA: hasta la
--    confirmación nada cambia.
--  * Se registra cuándo se avisó el resultado, para poder avisar solo a los
--    que aún no saben.
--
-- Base nueva: Docker la ejecuta sola después de 01 y 02.
-- Base existente:
--   docker exec -i becas-db psql -U becas -d becas < db/03_avance_etapas.sql
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Etapas configurables
-- ---------------------------------------------------------------------------
ALTER TABLE etapas ADD COLUMN IF NOT EXISTS cupo INTEGER CHECK (cupo IS NULL OR cupo > 0);

-- El orden pasa a ser "diferible" para poder insertar una etapa entre dos
-- existentes (se corren las siguientes en una sola transacción).
ALTER TABLE etapas DROP CONSTRAINT IF EXISTS ux_etapas_orden;
ALTER TABLE etapas ADD CONSTRAINT ux_etapas_orden UNIQUE (proceso_id, orden) DEFERRABLE INITIALLY IMMEDIATE;

-- ---------------------------------------------------------------------------
-- Etapa en que está cada estudiante
-- ---------------------------------------------------------------------------
ALTER TABLE postulaciones ADD COLUMN IF NOT EXISTS etapa_id UUID REFERENCES etapas(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS ix_postulaciones_etapa ON postulaciones (etapa_id);

-- Los invitados existentes quedan en la primera etapa del proceso
UPDATE postulaciones p SET etapa_id = (
  SELECT e.id FROM etapas e WHERE e.proceso_id = p.proceso_id ORDER BY e.orden LIMIT 1)
WHERE p.etapa_id IS NULL;

-- Estados del estudiante: se agrega EN_PROCESO (pasó al menos una etapa).
-- Los estados POSTULO / PRESELECCIONADO_1 / FINALISTA dejan de usarse: ahora
-- la etapa en que está cada uno dice hasta dónde llegó.
ALTER TABLE postulaciones DROP CONSTRAINT IF EXISTS postulaciones_estado_check;
ALTER TABLE postulaciones ADD CONSTRAINT postulaciones_estado_check CHECK (estado IN (
  'INVITADO', 'CONFIRMADO', 'EN_PROCESO', 'POSTULO', 'PRESELECCIONADO_1', 'FINALISTA',
  'BECARIO', 'NO_CONTINUA', 'DESISTIO'));

-- ---------------------------------------------------------------------------
-- Requisitos por etapa (lo que el estudiante debe entregar o completar)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS requisitos_etapa (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  etapa_id    UUID NOT NULL REFERENCES etapas(id) ON DELETE CASCADE,
  nombre      VARCHAR(150) NOT NULL,
  orden       INTEGER NOT NULL DEFAULT 0,
  activo      BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_requisitos_etapa ON requisitos_etapa (etapa_id, orden);

-- Una fila = el estudiante cumplió ese requisito.
CREATE TABLE IF NOT EXISTS cumplimientos (
  postulacion_id  UUID NOT NULL REFERENCES postulaciones(id) ON DELETE CASCADE,
  requisito_id    UUID NOT NULL REFERENCES requisitos_etapa(id) ON DELETE CASCADE,
  marcado_por     UUID REFERENCES usuarios(id),
  marcado_en      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (postulacion_id, requisito_id)
);

-- ---------------------------------------------------------------------------
-- Resultado de cada estudiante en cada etapa
-- ---------------------------------------------------------------------------
-- confirmado = FALSE: marca provisoria, se puede cambiar libremente.
-- confirmado = TRUE : ya se aplicó (el estudiante avanzó o quedó fuera).
-- estado_anterior / etapa_anterior: permiten deshacer una confirmación.
CREATE TABLE IF NOT EXISTS resultados_etapa (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  postulacion_id   UUID NOT NULL REFERENCES postulaciones(id) ON DELETE CASCADE,
  etapa_id         UUID NOT NULL REFERENCES etapas(id) ON DELETE CASCADE,
  resultado        VARCHAR(10) NOT NULL CHECK (resultado IN ('PASA', 'NO_PASA')),
  confirmado       BOOLEAN NOT NULL DEFAULT FALSE,
  estado_anterior  VARCHAR(30),
  marcado_por      UUID REFERENCES usuarios(id),
  marcado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmado_por   UUID REFERENCES usuarios(id),
  confirmado_en    TIMESTAMPTZ,
  avisado_en       TIMESTAMPTZ,
  CONSTRAINT ux_resultado UNIQUE (postulacion_id, etapa_id)
);
CREATE INDEX IF NOT EXISTS ix_resultados_etapa ON resultados_etapa (etapa_id, resultado, confirmado);

-- ---------------------------------------------------------------------------
-- Nuevo tipo de correo: informe de estudiantes para la contraparte
-- ---------------------------------------------------------------------------
ALTER TABLE plantillas_correo DROP CONSTRAINT IF EXISTS plantillas_correo_proposito_check;
ALTER TABLE plantillas_correo ADD CONSTRAINT plantillas_correo_proposito_check CHECK (proposito IN (
  'PRESENTACION', 'SOLICITUD_NOTAS', 'SOLICITUD_CONTACTOS', 'INVITACION_ESTUDIANTES',
  'AVISO_RESULTADO', 'AGRADECIMIENTO', 'INFORME_LICEO', 'OTRO'));

-- ---------------------------------------------------------------------------
-- Configuración inicial (según el documento de etapas 2026 del cliente)
-- ---------------------------------------------------------------------------
UPDATE etapas SET cupo = 60 WHERE nombre ILIKE 'Preselección N°1' AND cupo IS NULL;
UPDATE etapas SET cupo = 20 WHERE nombre ILIKE 'Preselección N°2' AND cupo IS NULL;
UPDATE etapas SET cupo = 10 WHERE nombre ILIKE 'Selección de becarios' AND cupo IS NULL;

-- Requisitos de la Preselección N°1 (punto 3 del documento: cuestionario,
-- RSH, certificado de notas y declaración de ingresos)
INSERT INTO requisitos_etapa (etapa_id, nombre, orden)
SELECT e.id, r.nombre, r.orden
  FROM etapas e
 CROSS JOIN (VALUES ('Formulario de postulación', 1), ('Cartola RSH', 2),
                    ('Certificado de notas', 3), ('Declaración de ingresos', 4)) AS r(nombre, orden)
 WHERE e.nombre ILIKE 'Preselección N°1'
   AND NOT EXISTS (SELECT 1 FROM requisitos_etapa x WHERE x.etapa_id = e.id);

-- Plantillas nuevas (solo si no existen)
INSERT INTO plantillas_correo (nombre, proposito, asunto, cuerpo)
SELECT * FROM (VALUES
  ('Informe de estudiantes para la contraparte', 'INFORME_LICEO',
   'Beca Carmen Goudie {{anio}} — Situación de los estudiantes de {{liceo}}',
   E'Estimado/a {{nombre}}:\n\nLe compartimos la situación actual de los estudiantes de {{liceo}} en el proceso de selección de la Beca Carmen Goudie {{anio}}:\n\n{{estudiantes}}\n\nAgradecemos su apoyo para recordar a los estudiantes los documentos que tienen pendientes.\n\nSaludos cordiales,\n{{firma}}'),
  ('Aviso: avanzas a la siguiente etapa', 'AVISO_RESULTADO',
   '¡Avanzas a la siguiente etapa de la Beca Carmen Goudie {{anio}}!',
   E'Hola {{nombre}}:\n\nNos alegra informarte que pasaste a la siguiente etapa del proceso de selección de la Beca Carmen Goudie {{anio}}. Pronto te enviaremos las instrucciones.\n\nSaludos,\n{{firma}}'),
  ('Aviso: no continúas en el proceso', 'AVISO_RESULTADO',
   'Resultado de tu postulación — Beca Carmen Goudie {{anio}}',
   E'Hola {{nombre}}:\n\nAgradecemos mucho tu participación en el proceso de selección de la Beca Carmen Goudie {{anio}}. En esta oportunidad no continúas a la siguiente etapa.\n\nCon la beca o sin la beca, te invitamos a seguir adelante detrás de tus sueños.\n\nSaludos,\n{{firma}}'),
  ('Recordatorio: documentos pendientes', 'OTRO',
   'Beca Carmen Goudie {{anio}} — Te faltan documentos',
   E'Hola {{nombre}}:\n\nPara continuar en el proceso de selección de la Beca Carmen Goudie {{anio}} todavía nos falta recibir:\n\n{{documentos_pendientes}}\n\nTe pedimos enviarlos lo antes posible. Si tienes dudas, puedes responder este correo o consultar con la contraparte de tu liceo.\n\nSaludos,\n{{firma}}')
) AS v(nombre, proposito, asunto, cuerpo)
WHERE NOT EXISTS (SELECT 1 FROM plantillas_correo p WHERE p.nombre = v.nombre);

COMMIT;
