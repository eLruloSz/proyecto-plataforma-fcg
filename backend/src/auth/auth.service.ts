import { BadRequestException, Injectable, Logger, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { AuditoriaService } from '../common/auditoria.service';
import { AccesoService } from './acceso.service';
import { filas } from '../common/sql';

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly log = new Logger('Auth');

  constructor(
    private readonly ds: DataSource,
    private readonly jwt: JwtService,
    private readonly cfg: ConfigService,
    private readonly auditoria: AuditoriaService,
    private readonly acceso: AccesoService,
  ) {}

  /**
   * Primer arranque en producción: si no existe ningún usuario y están
   * definidas ADMIN_EMAIL / ADMIN_PASSWORD, crea ese usuario (rol EQUIPO).
   * Desde ahí, el resto de las cuentas se crean por invitación en "Usuarios".
   */
  async onModuleInit() {
    const email = this.cfg.get<string>('ADMIN_EMAIL');
    const password = this.cfg.get<string>('ADMIN_PASSWORD');
    if (!email || !password) return;
    const [{ n }] = await this.ds.query(`SELECT COUNT(*)::int AS n FROM usuarios`);
    if (n > 0) return;
    await this.ds.query(
      `INSERT INTO usuarios (email, password_hash, nombre_completo, rol) VALUES ($1, $2, $3, 'EQUIPO')`,
      [email.toLowerCase(), await bcrypt.hash(password, 10), this.cfg.get('ADMIN_NOMBRE') ?? 'Administración'],
    );
    this.log.log(`Usuario inicial creado: ${email}`);
  }

  private async emitirToken(u: { id: string; email: string; nombre_completo: string; rol: string; sesion_version: number }) {
    const token = await this.jwt.signAsync({ sub: u.id, email: u.email, nombre: u.nombre_completo, v: u.sesion_version });
    return { token, usuario: { id: u.id, email: u.email, nombre: u.nombre_completo, rol: u.rol } };
  }

  async login(email: string, password: string) {
    const [u] = await this.ds.query(
      `SELECT id, email, password_hash, nombre_completo, rol, activo, sesion_version FROM usuarios WHERE LOWER(email) = LOWER($1)`,
      [email.trim()],
    );
    // Mismo mensaje si el usuario no existe, no ha creado su contraseña o la clave es incorrecta.
    const ok = u && u.activo && u.password_hash && (await bcrypt.compare(password, u.password_hash));
    if (!ok) throw new UnauthorizedException('Correo o contraseña incorrectos.');

    await this.ds.query(`UPDATE usuarios SET ultimo_acceso = NOW() WHERE id = $1`, [u.id]);
    await this.auditoria.registrar(u.id, 'LOGIN');
    return this.emitirToken(u);
  }

  async perfil(id: string) {
    const [u] = await this.ds.query(
      `SELECT id, email, nombre_completo AS nombre, firma, rol FROM usuarios WHERE id = $1`,
      [id],
    );
    return u;
  }

  async actualizarPerfil(id: string, datos: { nombre?: string; firma?: string }) {
    await this.ds.query(
      `UPDATE usuarios SET nombre_completo = COALESCE($2, nombre_completo), firma = COALESCE($3, firma) WHERE id = $1`,
      [id, datos.nombre ?? null, datos.firma ?? null],
    );
    return this.perfil(id);
  }

  /** Cambia la clave y cierra las demás sesiones. Devuelve un token nuevo para seguir en esta. */
  async cambiarPassword(id: string, actual: string, nueva: string) {
    const [u] = await this.ds.query(`SELECT password_hash FROM usuarios WHERE id = $1`, [id]);
    if (!u?.password_hash || !(await bcrypt.compare(actual, u.password_hash))) {
      throw new BadRequestException('La contraseña actual no es correcta.');
    }
    const [act] = filas(await this.ds.query(
      `UPDATE usuarios SET password_hash = $2, sesion_version = sesion_version + 1 WHERE id = $1
       RETURNING id, email, nombre_completo, rol, sesion_version`,
      [id, await bcrypt.hash(nueva, 10)],
    ));
    await this.auditoria.registrar(id, 'CAMBIO_PASSWORD');
    return this.emitirToken(act);
  }

  /**
   * "¿Olvidaste tu contraseña?". Responde siempre lo mismo, exista o no el
   * correo, para que no se pueda averiguar quién tiene cuenta.
   * Si la persona aún no creó su contraseña (invitación pendiente), se le
   * reenvía la invitación en vez de un enlace de restablecimiento.
   */
  async solicitarRestablecimiento(email: string) {
    const [u] = await this.ds.query(
      `SELECT id, email, nombre_completo AS nombre, password_hash IS NOT NULL AS tiene_clave
         FROM usuarios WHERE LOWER(email) = LOWER($1) AND activo`,
      [email.trim()],
    );
    if (u) {
      this.acceso.enviarEnSegundoPlano(async () => {
        const tipo = u.tiene_clave ? 'RESTABLECER' : 'INVITACION';
        const token = await this.acceso.crearEnlace(u.id, tipo, null);
        await this.acceso.enviarCorreo(u, tipo, token);
        await this.auditoria.registrar(u.id, 'SOLICITUD_RESTABLECER');
      });
    }
    return { ok: true };
  }

  /** Para que la pantalla del enlace muestre a quién corresponde antes de pedir la clave. */
  async verEnlace(token: string) {
    const t = await this.acceso.buscarVigente(token);
    return { tipo: t.tipo, email: t.email, nombre: t.nombre };
  }

  /** Usa el enlace: fija la contraseña, cierra otras sesiones y deja la sesión iniciada. */
  async usarEnlace(token: string, password: string, nombre?: string) {
    const u = await this.ds.transaction(async (em) => {
      const t = await this.acceso.buscarVigente(token, em, true);
      await em.query(`UPDATE tokens_usuario SET usado_en = NOW() WHERE usuario_id = $1 AND usado_en IS NULL`, [t.usuario_id]);
      const [fila] = filas(await em.query(
        `UPDATE usuarios SET password_hash = $2, sesion_version = sesion_version + 1, ultimo_acceso = NOW(),
                nombre_completo = COALESCE($3, nombre_completo)
          WHERE id = $1 RETURNING id, email, nombre_completo, rol, sesion_version`,
        [t.usuario_id, await bcrypt.hash(password, 10), t.tipo === 'INVITACION' && nombre?.trim() ? nombre.trim() : null],
      ));
      await this.auditoria.registrar(t.usuario_id, t.tipo === 'INVITACION' ? 'INVITACION_ACEPTADA' : 'PASSWORD_RESTABLECIDA', undefined, undefined, undefined, em);
      return fila;
    });
    return this.emitirToken(u);
  }
}
