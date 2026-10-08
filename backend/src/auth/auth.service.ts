import { BadRequestException, Injectable, Logger, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { AuditoriaService } from '../common/auditoria.service';

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly log = new Logger('Auth');

  constructor(
    private readonly ds: DataSource,
    private readonly jwt: JwtService,
    private readonly cfg: ConfigService,
    private readonly auditoria: AuditoriaService,
  ) {}

  /**
   * Primer arranque en producción: si no existe ningún usuario y están
   * definidas ADMIN_EMAIL / ADMIN_PASSWORD, crea ese usuario. Así no hace
   * falta cargar datos de prueba para poder entrar.
   */
  async onModuleInit() {
    const email = this.cfg.get<string>('ADMIN_EMAIL');
    const password = this.cfg.get<string>('ADMIN_PASSWORD');
    if (!email || !password) return;
    const [{ n }] = await this.ds.query(`SELECT COUNT(*)::int AS n FROM usuarios`);
    if (n > 0) return;
    await this.ds.query(
      `INSERT INTO usuarios (email, password_hash, nombre_completo) VALUES ($1, $2, $3)`,
      [email.toLowerCase(), await bcrypt.hash(password, 10), this.cfg.get('ADMIN_NOMBRE') ?? 'Administración'],
    );
    this.log.log(`Usuario inicial creado: ${email}`);
  }

  async login(email: string, password: string) {
    const [u] = await this.ds.query(
      `SELECT id, email, password_hash, nombre_completo, activo FROM usuarios WHERE LOWER(email) = LOWER($1)`,
      [email.trim()],
    );
    // Mismo mensaje si el usuario no existe o la clave es incorrecta.
    const ok = u && u.activo && (await bcrypt.compare(password, u.password_hash));
    if (!ok) throw new UnauthorizedException('Correo o contraseña incorrectos.');

    await this.ds.query(`UPDATE usuarios SET ultimo_acceso = NOW() WHERE id = $1`, [u.id]);
    await this.auditoria.registrar(u.id, 'LOGIN');
    const token = await this.jwt.signAsync({ sub: u.id, email: u.email, nombre: u.nombre_completo });
    return { token, usuario: { id: u.id, email: u.email, nombre: u.nombre_completo } };
  }

  async perfil(id: string) {
    const [u] = await this.ds.query(
      `SELECT id, email, nombre_completo AS nombre, firma FROM usuarios WHERE id = $1`,
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

  async cambiarPassword(id: string, actual: string, nueva: string) {
    const [u] = await this.ds.query(`SELECT password_hash FROM usuarios WHERE id = $1`, [id]);
    if (!u || !(await bcrypt.compare(actual, u.password_hash))) {
      throw new BadRequestException('La contraseña actual no es correcta.');
    }
    await this.ds.query(`UPDATE usuarios SET password_hash = $2 WHERE id = $1`, [id, await bcrypt.hash(nueva, 10)]);
    await this.auditoria.registrar(id, 'CAMBIO_PASSWORD');
    return { ok: true };
  }
}
