import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AccesoService } from '../auth/acceso.service';
import { AuditoriaService } from '../common/auditoria.service';
import { Rol } from '../auth/public.decorator';

/**
 * Administración de cuentas (solo rol EQUIPO). No hay registro abierto:
 * las cuentas se crean por invitación y la persona elige su contraseña.
 * No se eliminan usuarios (quedan en la auditoría y en lo que registraron);
 * se desactivan.
 */
@Injectable()
export class UsuariosService {
  private readonly log = new Logger('Usuarios');

  constructor(
    private readonly ds: DataSource,
    private readonly acceso: AccesoService,
    private readonly auditoria: AuditoriaService,
  ) {}

  listar() {
    return this.ds.query(`
      SELECT u.id, u.email, u.nombre_completo AS nombre, u.rol, u.activo, u.ultimo_acceso, u.creado_en,
             i.nombre_completo AS invitado_por,
             inv.expira_en AS invitacion_vence,
             CASE
               WHEN NOT u.activo THEN 'DESACTIVADO'
               WHEN u.password_hash IS NOT NULL THEN 'ACTIVO'
               WHEN inv.id IS NOT NULL THEN 'INVITACION_PENDIENTE'
               ELSE 'INVITACION_VENCIDA'
             END AS estado
        FROM usuarios u
        LEFT JOIN usuarios i ON i.id = u.invitado_por
        LEFT JOIN LATERAL (
          SELECT t.id, t.expira_en FROM tokens_usuario t
           WHERE t.usuario_id = u.id AND t.tipo = 'INVITACION' AND t.usado_en IS NULL AND t.expira_en > NOW()
           ORDER BY t.creado_en DESC LIMIT 1
        ) inv ON TRUE
       ORDER BY u.activo DESC, u.rol, u.nombre_completo`);
  }

  async invitar(datos: { email: string; nombre: string; rol: Rol }, por: { id: string; nombre: string }) {
    const email = datos.email.trim().toLowerCase();
    const [existe] = await this.ds.query(`SELECT 1 FROM usuarios WHERE LOWER(email) = $1`, [email]);
    if (existe) throw new ConflictException('Ya existe un usuario con ese correo.');

    const { id, token } = await this.ds.transaction(async (em) => {
      const [u] = await em.query(
        `INSERT INTO usuarios (email, password_hash, nombre_completo, rol, invitado_por)
         VALUES ($1, NULL, $2, $3, $4) RETURNING id`,
        [email, datos.nombre.trim(), datos.rol, por.id],
      );
      const token = await this.acceso.crearEnlace(u.id, 'INVITACION', por.id, em);
      await this.auditoria.registrar(por.id, 'USUARIO_INVITADO', 'usuarios', u.id, { email, rol: datos.rol }, em);
      return { id: u.id as string, token };
    });

    const correoEnviado = await this.enviar({ email, nombre: datos.nombre.trim() }, 'INVITACION', token, por.nombre);
    return { id, correoEnviado };
  }

  /** Reenvía la invitación (si aún no tiene contraseña) o manda un enlace para restablecerla. */
  async enviarEnlace(id: string, por: { id: string; nombre: string }) {
    const u = await this.obtener(id);
    if (!u.activo) throw new BadRequestException('La cuenta está desactivada. Actívala primero.');
    const tipo = u.tiene_clave ? 'RESTABLECER' : 'INVITACION';
    const token = await this.acceso.crearEnlace(id, tipo, por.id);
    await this.auditoria.registrar(por.id, tipo === 'INVITACION' ? 'INVITACION_REENVIADA' : 'RESTABLECER_ENVIADO', 'usuarios', id);
    const correoEnviado = await this.enviar(u, tipo, token, por.nombre);
    return { tipo, correoEnviado };
  }

  async actualizar(id: string, datos: { rol?: Rol; activo?: boolean; nombre?: string }, por: { id: string }) {
    if (id === por.id && (datos.rol !== undefined || datos.activo !== undefined)) {
      throw new BadRequestException('No puedes cambiar tu propio rol ni desactivar tu propia cuenta.');
    }
    const u = await this.obtener(id);
    const quedaEquipo = (datos.rol ?? u.rol) === 'EQUIPO' && (datos.activo ?? u.activo);
    if (u.rol === 'EQUIPO' && u.activo && !quedaEquipo) {
      const [{ n }] = await this.ds.query(
        `SELECT COUNT(*)::int AS n FROM usuarios WHERE rol = 'EQUIPO' AND activo AND id <> $1`, [id]);
      if (n === 0) throw new BadRequestException('Debe quedar al menos una cuenta activa del equipo.');
    }

    // Desactivar o cambiar el rol cierra las sesiones abiertas de esa persona.
    const cierraSesion = (datos.activo === false && u.activo) || (datos.rol !== undefined && datos.rol !== u.rol);
    await this.ds.transaction(async (em) => {
      await em.query(
        `UPDATE usuarios SET rol = COALESCE($2, rol), activo = COALESCE($3, activo),
                nombre_completo = COALESCE($4, nombre_completo),
                sesion_version = sesion_version + $5
          WHERE id = $1`,
        [id, datos.rol ?? null, datos.activo ?? null, datos.nombre?.trim() || null, cierraSesion ? 1 : 0],
      );
      if (datos.activo === false) {
        await em.query(`UPDATE tokens_usuario SET usado_en = NOW() WHERE usuario_id = $1 AND usado_en IS NULL`, [id]);
      }
      await this.auditoria.registrar(por.id, 'USUARIO_ACTUALIZADO', 'usuarios', id, datos, em);
    });
    return { ok: true };
  }

  private async obtener(id: string) {
    const [u] = await this.ds.query(
      `SELECT id, email, nombre_completo AS nombre, rol, activo, password_hash IS NOT NULL AS tiene_clave
         FROM usuarios WHERE id = $1`,
      [id],
    );
    if (!u) throw new NotFoundException('Usuario no encontrado.');
    return u as { id: string; email: string; nombre: string; rol: Rol; activo: boolean; tiene_clave: boolean };
  }

  /** Si el correo falla la cuenta queda creada igual y se puede reenviar desde la lista. */
  private async enviar(u: { email: string; nombre: string }, tipo: 'INVITACION' | 'RESTABLECER', token: string, por: string) {
    try {
      await this.acceso.enviarCorreo(u, tipo, token, por);
      return true;
    } catch (e) {
      this.log.error(`No se pudo enviar el correo a ${u.email}: ${(e as Error).message}`);
      return false;
    }
  }
}
