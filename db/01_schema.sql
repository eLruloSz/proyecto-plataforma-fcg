-- ============================================================================
-- SISTEMA DE GESTIÓN DE POSTULACIONES — Beca Carmen Goudie
-- Esquema PostgreSQL v3
--
-- Cambios respecto a v2 (según plantillas reales del cliente):
--   * Nómina de alumnos (lo que manda cada liceo) separada de las postulaciones.
--     Solo los invitados pasan a ser postulaciones.
--   * Id de invitado generado por el sistema: <liceo>.<correlativo><sufijo>
--     (ej. 01.006a). El correlativo es único por proceso, no se reinicia por liceo.
--   * Un solo tipo de destinatario por liceo: la contraparte (más el director,
--     que existe antes de confirmar contraparte).
--   * Envíos con seguimiento por destinatario: entrega (automática) y
--     respuesta (marcada a mano o automáticamente).
--   * Catálogo de hitos por liceo configurable (no hardcodeado).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION fn_actualizar_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.actualizado_en = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ============================================================================
-- USUARIOS (2 personas de la fundación, mismo rol)
-- ============================================================================
CREATE TABLE usuarios (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email            VARCHAR(255) NOT NULL,
  password_hash    VARCHAR(255) NOT NULL,
  nombre_completo  VARCHAR(200) NOT NULL,
  firma            TEXT,                         -- firma que se agrega al final de los correos
  activo           BOOLEAN NOT NULL DEFAULT TRUE,
  ultimo_acceso    TIMESTAMPTZ,
  creado_en        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX ux_usuarios_email ON usuarios (LOWER(email));
CREATE TRIGGER tg_usuarios_ts BEFORE UPDATE ON usuarios
  FOR EACH ROW EXECUTE FUNCTION fn_actualizar_timestamp();


-- ============================================================================
-- LICEOS y CONTACTOS
-- ============================================================================
-- codigo: número del liceo en el Id de los invitados ("01", "02"...).
CREATE TABLE liceos (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo           VARCHAR(4)   NOT NULL,
  nombre           VARCHAR(200) NOT NULL,
  comuna           VARCHAR(100),
  direccion        TEXT,
  telefono         VARCHAR(60),
  activo           BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ux_liceos_codigo UNIQUE (codigo)
);
CREATE TRIGGER tg_liceos_ts BEFORE UPDATE ON liceos
  FOR EACH ROW EXECUTE FUNCTION fn_actualizar_timestamp();

-- tipo CONTRAPARTE: encargado/a de la beca en el liceo (destinatario habitual).
-- tipo DIRECTOR: se usa para el primer contacto, antes de confirmar contraparte.
-- cargo: texto libre tal como lo informa el liceo (Orientadora, Jefa UTP...).
CREATE TABLE contactos_liceo (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  liceo_id         UUID NOT NULL REFERENCES liceos(id) ON DELETE CASCADE,
  tipo             VARCHAR(20) NOT NULL CHECK (tipo IN ('CONTRAPARTE', 'DIRECTOR')),
  nombre           VARCHAR(200) NOT NULL,
  cargo            VARCHAR(150),
  email            VARCHAR(255),
  telefono         VARCHAR(60),
  creado_en        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Un solo contacto de cada tipo por liceo
CREATE UNIQUE INDEX ux_contacto_tipo ON contactos_liceo (liceo_id, tipo);
CREATE TRIGGER tg_contactos_ts BEFORE UPDATE ON contactos_liceo
  FOR EACH ROW EXECUTE FUNCTION fn_actualizar_timestamp();


-- ============================================================================
-- PROCESOS y ETAPAS
-- ============================================================================
-- sufijo_id: letra final del Id de invitados ("a"). Configurable.
-- ultimo_correlativo: último número de Id entregado en este proceso.
--   Nunca baja: un Id entregado no se reutiliza aunque se elimine al invitado.
CREATE TABLE procesos (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre               VARCHAR(200) NOT NULL,
  anio                 INTEGER NOT NULL,
  estado               VARCHAR(20) NOT NULL DEFAULT 'ACTIVO'
                         CHECK (estado IN ('BORRADOR', 'ACTIVO', 'CERRADO')),
  sufijo_id            VARCHAR(2) NOT NULL DEFAULT 'a',
  ultimo_correlativo   INTEGER NOT NULL DEFAULT 0,
  creado_en            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ux_procesos_anio UNIQUE (anio)
);
CREATE TRIGGER tg_procesos_ts BEFORE UPDATE ON procesos
  FOR EACH ROW EXECUTE FUNCTION fn_actualizar_timestamp();

-- Colores en la interfaz: CERRADA = verde, ACTIVA = amarillo, PENDIENTE = gris.
CREATE TABLE etapas (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proceso_id     UUID NOT NULL REFERENCES procesos(id) ON DELETE CASCADE,
  orden          INTEGER NOT NULL,
  nombre         VARCHAR(150) NOT NULL,
  descripcion    TEXT,
  estado         VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE'
                   CHECK (estado IN ('PENDIENTE', 'ACTIVA', 'CERRADA')),
  fecha_inicio   DATE,
  fecha_fin      DATE,
  CONSTRAINT ux_etapas_orden UNIQUE (proceso_id, orden)
);
-- Solo una etapa activa por proceso
CREATE UNIQUE INDEX ux_etapa_activa ON etapas (proceso_id) WHERE estado = 'ACTIVA';


-- ============================================================================
-- PARTICIPACIÓN DEL LICEO EN EL PROCESO (respuesta al correo de presentación)
-- ============================================================================
CREATE TABLE participaciones_liceo (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proceso_id       UUID NOT NULL REFERENCES procesos(id) ON DELETE CASCADE,
  liceo_id         UUID NOT NULL REFERENCES liceos(id) ON DELETE CASCADE,
  estado           VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE'
                     CHECK (estado IN ('PENDIENTE', 'PARTICIPA', 'NO_PARTICIPA')),
  observaciones    TEXT,
  actualizado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ux_participacion UNIQUE (proceso_id, liceo_id)
);
CREATE TRIGGER tg_participaciones_ts BEFORE UPDATE ON participaciones_liceo
  FOR EACH ROW EXECUTE FUNCTION fn_actualizar_timestamp();


-- ============================================================================
-- HITOS POR LICEO (reemplaza la planilla de seguimiento con semáforo)
-- ============================================================================
-- El catálogo es configurable: si el próximo año cambia el checklist, se
-- agregan o desactivan filas, no columnas.
CREATE TABLE catalogo_hitos (
  codigo        VARCHAR(50) PRIMARY KEY,
  nombre        VARCHAR(150) NOT NULL,
  orden         INTEGER NOT NULL,
  activo        BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE hitos_liceo (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proceso_id       UUID NOT NULL REFERENCES procesos(id) ON DELETE CASCADE,
  liceo_id         UUID NOT NULL REFERENCES liceos(id) ON DELETE CASCADE,
  codigo           VARCHAR(50) NOT NULL REFERENCES catalogo_hitos(codigo),
  completado       BOOLEAN NOT NULL DEFAULT FALSE,
  automatico       BOOLEAN NOT NULL DEFAULT FALSE,   -- lo marcó el sistema, no una persona
  fecha            TIMESTAMPTZ,
  observaciones    TEXT,
  actualizado_por  UUID REFERENCES usuarios(id),
  actualizado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ux_hito UNIQUE (proceso_id, liceo_id, codigo)
);
CREATE TRIGGER tg_hitos_ts BEFORE UPDATE ON hitos_liceo
  FOR EACH ROW EXECUTE FUNCTION fn_actualizar_timestamp();


-- ============================================================================
-- CARGAS DE ARCHIVOS (trazabilidad de cada Excel subido)
-- ============================================================================
CREATE TABLE cargas (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proceso_id       UUID NOT NULL REFERENCES procesos(id) ON DELETE CASCADE,
  liceo_id         UUID REFERENCES liceos(id) ON DELETE SET NULL,
  tipo             VARCHAR(30) NOT NULL CHECK (tipo IN ('NOMINA_NOTAS', 'RANKING')),
  nombre_archivo   VARCHAR(255) NOT NULL,
  filas_ok         INTEGER NOT NULL DEFAULT 0,
  advertencias     JSONB NOT NULL DEFAULT '[]'::jsonb,
  cargado_por      UUID REFERENCES usuarios(id),
  cargado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================================
-- NÓMINA DE ALUMNOS (lo que manda cada liceo, todos sus alumnos de 3° medio)
-- ============================================================================
-- Se guarda lo mínimo necesario para ordenar y elegir invitados. Los alumnos
-- que no quedan invitados no pasan a ninguna otra tabla.
CREATE TABLE alumnos_nomina (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proceso_id         UUID NOT NULL REFERENCES procesos(id) ON DELETE CASCADE,
  liceo_id           UUID NOT NULL REFERENCES liceos(id) ON DELETE CASCADE,
  carga_id           UUID NOT NULL REFERENCES cargas(id) ON DELETE CASCADE,
  curso              VARCHAR(10) NOT NULL,       -- normalizado: "3°A"
  curso_original     VARCHAR(100),               -- como venía: "3° año A"
  especialidad       VARCHAR(200),
  n_lista            INTEGER,
  apellido_paterno   VARCHAR(100) NOT NULL,
  apellido_materno   VARCHAR(100),
  nombres            VARCHAR(150) NOT NULL,
  promedio_1m        NUMERIC(3,2) CHECK (promedio_1m BETWEEN 1.0 AND 7.0),
  promedio_2m        NUMERIC(3,2) CHECK (promedio_2m BETWEEN 1.0 AND 7.0),
  promedio           NUMERIC(4,3),               -- promedio de 1° y 2° medio
  posicion_curso     INTEGER                     -- 1 = mejor promedio del curso (empates comparten)
);
CREATE INDEX ix_nomina_liceo_curso ON alumnos_nomina (proceso_id, liceo_id, curso, posicion_curso);


-- ============================================================================
-- PERSONAS y POSTULACIONES (solo invitados)
-- ============================================================================
CREATE TABLE personas (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rut                VARCHAR(12),                 -- se completa más adelante, si se pide
  nombres            VARCHAR(150) NOT NULL,
  apellido_paterno   VARCHAR(100) NOT NULL,
  apellido_materno   VARCHAR(100),
  email              VARCHAR(255),
  telefono           VARCHAR(60),
  creado_en          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX ux_personas_rut ON personas (rut) WHERE rut IS NOT NULL;
CREATE TRIGGER tg_personas_ts BEFORE UPDATE ON personas
  FOR EACH ROW EXECUTE FUNCTION fn_actualizar_timestamp();

-- Eventos: encuentro online de presentación (3 fechas), visitas a liceos.
CREATE TABLE eventos (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proceso_id       UUID NOT NULL REFERENCES procesos(id) ON DELETE CASCADE,
  tipo             VARCHAR(30) NOT NULL CHECK (tipo IN ('ENCUENTRO_ONLINE', 'VISITA_LICEO')),
  liceo_id         UUID REFERENCES liceos(id) ON DELETE CASCADE,
  fecha            TIMESTAMPTZ NOT NULL,
  enlace           TEXT,
  observaciones    TEXT,
  creado_en        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- codigo: el Id del invitado (01.006a). Se genera al invitar y no cambia.
CREATE TABLE postulaciones (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proceso_id               UUID NOT NULL REFERENCES procesos(id) ON DELETE CASCADE,
  persona_id               UUID NOT NULL REFERENCES personas(id),
  liceo_id                 UUID NOT NULL REFERENCES liceos(id),
  alumno_nomina_id         UUID REFERENCES alumnos_nomina(id) ON DELETE SET NULL,
  codigo                   VARCHAR(12) NOT NULL,
  correlativo              INTEGER NOT NULL,
  curso                    VARCHAR(10),
  promedio                 NUMERIC(4,3),
  posicion_curso           INTEGER,
  estado                   VARCHAR(30) NOT NULL DEFAULT 'INVITADO' CHECK (estado IN (
                             'INVITADO',            -- elegido como invitado
                             'CONFIRMADO',          -- confirmó interés (formulario 1)
                             'POSTULO',             -- envió la postulación completa
                             'PRESELECCIONADO_1',   -- pasa a entrevista
                             'FINALISTA',           -- pasa a entrevista con comité
                             'BECARIO',
                             'NO_CONTINUA',         -- no pasó un corte
                             'DESISTIO')),
  confirmacion             VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE'
                             CHECK (confirmacion IN ('PENDIENTE', 'CONFIRMADO', 'RECHAZADO')),
  confirmacion_en          TIMESTAMPTZ,
  encuentro_evento_id      UUID REFERENCES eventos(id) ON DELETE SET NULL,
  asistio_encuentro        BOOLEAN,
  creado_en                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ux_postulacion_codigo UNIQUE (proceso_id, codigo),
  CONSTRAINT ux_postulacion_correlativo UNIQUE (proceso_id, correlativo),
  CONSTRAINT ux_postulacion_nomina UNIQUE (alumno_nomina_id)
);
CREATE INDEX ix_postulaciones_estado ON postulaciones (proceso_id, estado);
CREATE INDEX ix_postulaciones_liceo ON postulaciones (proceso_id, liceo_id);
CREATE TRIGGER tg_postulaciones_ts BEFORE UPDATE ON postulaciones
  FOR EACH ROW EXECUTE FUNCTION fn_actualizar_timestamp();

CREATE TABLE comentarios_postulacion (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  postulacion_id   UUID NOT NULL REFERENCES postulaciones(id) ON DELETE CASCADE,
  autor_id         UUID REFERENCES usuarios(id),
  texto            TEXT NOT NULL,
  creado_en        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================================
-- COMUNICACIÓN
-- ============================================================================
-- proposito: para qué sirve el correo. Permite automatizar: subir la nómina
-- de un liceo marca como respondido el último envío SOLICITUD_NOTAS a ese liceo.
CREATE TABLE plantillas_correo (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre           VARCHAR(200) NOT NULL,
  proposito        VARCHAR(30) NOT NULL DEFAULT 'OTRO' CHECK (proposito IN (
                     'PRESENTACION', 'SOLICITUD_NOTAS', 'SOLICITUD_CONTACTOS',
                     'INVITACION_ESTUDIANTES', 'AVISO_RESULTADO', 'AGRADECIMIENTO', 'OTRO')),
  asunto           VARCHAR(300) NOT NULL,
  cuerpo           TEXT NOT NULL,                 -- texto con variables {{liceo}}, {{contraparte}}...
  activo           BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER tg_plantillas_ts BEFORE UPDATE ON plantillas_correo
  FOR EACH ROW EXECUTE FUNCTION fn_actualizar_timestamp();

-- Archivos guardados en disco; la base solo guarda la referencia.
CREATE TABLE archivos (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre_original  VARCHAR(255) NOT NULL,
  ruta             TEXT NOT NULL,
  mime_type        VARCHAR(150),
  tamano_bytes     BIGINT,
  creado_en        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE plantilla_adjuntos (
  plantilla_id     UUID NOT NULL REFERENCES plantillas_correo(id) ON DELETE CASCADE,
  archivo_id       UUID NOT NULL REFERENCES archivos(id) ON DELETE CASCADE,
  PRIMARY KEY (plantilla_id, archivo_id)
);

-- grupo: a quién se dirigió (CONTRAPARTES, DIRECTORES, LICEO, POSTULANTES).
-- envio_origen_id: si es un "reenviar a los que faltan", apunta al envío original.
CREATE TABLE envios (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proceso_id         UUID NOT NULL REFERENCES procesos(id) ON DELETE CASCADE,
  plantilla_id       UUID REFERENCES plantillas_correo(id) ON DELETE SET NULL,
  envio_origen_id    UUID REFERENCES envios(id) ON DELETE SET NULL,
  proposito          VARCHAR(30) NOT NULL DEFAULT 'OTRO',
  grupo              VARCHAR(20) NOT NULL CHECK (grupo IN ('CONTRAPARTES', 'DIRECTORES', 'LICEO', 'POSTULANTES')),
  asunto             VARCHAR(300) NOT NULL,     -- tal como se escribió (con variables)
  cuerpo             TEXT NOT NULL,
  total              INTEGER NOT NULL DEFAULT 0,
  enviado_por        UUID REFERENCES usuarios(id),
  enviado_en         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ix_envios_proceso ON envios (proceso_id, enviado_en DESC);

CREATE TABLE envio_adjuntos (
  envio_id         UUID NOT NULL REFERENCES envios(id) ON DELETE CASCADE,
  archivo_id       UUID NOT NULL REFERENCES archivos(id) ON DELETE CASCADE,
  PRIMARY KEY (envio_id, archivo_id)
);

-- Una fila por destinatario.
--   entrega:   lo sabe el sistema (SMTP aceptó, falló, o webhook del proveedor).
--   respuesta: la marca una persona ("tachar"), o el sistema cuando puede
--              deducirla (ej. se subió la nómina de ese liceo).
CREATE TABLE envio_destinatarios (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  envio_id           UUID NOT NULL REFERENCES envios(id) ON DELETE CASCADE,
  liceo_id           UUID REFERENCES liceos(id) ON DELETE SET NULL,
  postulacion_id     UUID REFERENCES postulaciones(id) ON DELETE SET NULL,
  nombre             VARCHAR(200),
  email              VARCHAR(255) NOT NULL,
  asunto_final       VARCHAR(300) NOT NULL,     -- con las variables ya reemplazadas
  cuerpo_final       TEXT NOT NULL,
  entrega            VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE'
                       CHECK (entrega IN ('PENDIENTE', 'ENVIADO', 'ENTREGADO', 'REBOTADO', 'FALLIDO')),
  error              TEXT,
  id_externo         VARCHAR(255),
  respuesta          VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE'
                       CHECK (respuesta IN ('PENDIENTE', 'RESPONDIDO')),
  respuesta_nota     TEXT,
  respuesta_auto     BOOLEAN NOT NULL DEFAULT FALSE,
  respondido_en      TIMESTAMPTZ,
  respondido_por     UUID REFERENCES usuarios(id),
  actualizado_en     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ix_destinatarios_envio ON envio_destinatarios (envio_id);
CREATE INDEX ix_destinatarios_liceo ON envio_destinatarios (liceo_id);
CREATE INDEX ix_destinatarios_externo ON envio_destinatarios (id_externo);
CREATE TRIGGER tg_destinatarios_ts BEFORE UPDATE ON envio_destinatarios
  FOR EACH ROW EXECUTE FUNCTION fn_actualizar_timestamp();


-- ============================================================================
-- AUDITORÍA
-- ============================================================================
CREATE TABLE auditoria (
  id           BIGSERIAL PRIMARY KEY,
  usuario_id   UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  accion       VARCHAR(100) NOT NULL,
  entidad      VARCHAR(100),
  entidad_id   UUID,
  detalle      JSONB,
  fecha        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ix_auditoria_fecha ON auditoria (fecha DESC);


-- ============================================================================
-- DATOS BASE (no son de prueba: el catálogo de hitos de la planilla real)
-- ============================================================================
INSERT INTO catalogo_hitos (codigo, nombre, orden) VALUES
  ('MAIL_PRESENTACION',   'Correo de presentación',               1),
  ('ACUSO_RECIBO',        'Acuso de recibo',                      2),
  ('MAIL_SOLICITUD_NOTAS','Solicitud de nómina de notas',         3),
  ('RECEPCION_NOMINA',    'Recepción de nómina',                  4),
  ('DEFINICION_INVITADOS','Revisión y definición de invitados',   5),
  ('MAIL_APROBACION',     'Envío de invitados para aprobación',   6),
  ('APROBACION_CONTACTOS','Aprobación y datos de contacto',       7),
  ('INVITACION_ESTUDIANTES','Invitación a estudiantes',           8),
  ('VISITA',              'Visita al liceo',                      9),
  ('MAIL_AGRADECIMIENTO', 'Correo de agradecimiento',             10),
  ('CIERRE_ETAPA_1',      'Cierre primera etapa',                 11),
  ('NOTIF_PRESELECCION',  'Notificación de preselección',         12);
