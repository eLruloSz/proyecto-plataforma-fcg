-- ============================================================================
-- 11. Acceso de usuarios: roles, invitaciones y "¿Olvidaste tu contraseña?"
--   - rol EQUIPO: las personas que trabajan el proceso (hacen todo).
--   - rol LECTOR: invitados que solo consultan (ej. director de la fundación).
--   - No hay registro abierto: un usuario del equipo invita por correo y la
--     persona crea su contraseña con el enlace (por eso password_hash puede ser
--     NULL mientras la invitación está pendiente).
--   - sesion_version: al cambiar o restablecer la contraseña, o al desactivar
--     la cuenta, se incrementa y las sesiones abiertas dejan de valer.
--   - tokens_usuario guarda solo el hash SHA-256 del enlace, nunca el enlace.
-- ============================================================================
BEGIN;

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS rol VARCHAR(10) NOT NULL DEFAULT 'EQUIPO';
ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS ck_usuarios_rol;
ALTER TABLE usuarios ADD CONSTRAINT ck_usuarios_rol CHECK (rol IN ('EQUIPO', 'LECTOR'));
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS sesion_version INT NOT NULL DEFAULT 0;
ALTER TABLE usuarios ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS invitado_por UUID REFERENCES usuarios(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS tokens_usuario (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id  UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  tipo        VARCHAR(12) NOT NULL CHECK (tipo IN ('INVITACION', 'RESTABLECER')),
  token_hash  CHAR(64) NOT NULL,
  expira_en   TIMESTAMPTZ NOT NULL,
  usado_en    TIMESTAMPTZ,
  creado_por  UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_tokens_usuario_hash ON tokens_usuario (token_hash);
CREATE INDEX IF NOT EXISTS ix_tokens_usuario_usuario ON tokens_usuario (usuario_id, tipo);

COMMIT;
