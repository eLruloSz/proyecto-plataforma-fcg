import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import { ES_PUBLICO, PERMITE_LECTOR, SOLO_EQUIPO } from './public.decorator';

/**
 * Todos los endpoints requieren sesión salvo los marcados con @Publico().
 *
 * En cada petición se vuelve a leer el usuario de la base (son pocos usuarios,
 * es barato). Así una cuenta desactivada, un cambio de rol o un cambio de
 * contraseña (sesion_version) se aplican al tiro, sin esperar a que venza el token.
 *
 * Rol LECTOR: solo consultas (GET), salvo endpoints marcados con @PermitirLector().
 * @SoloEquipo() bloquea al lector también en consultas.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly jwt: JwtService, private readonly ds: DataSource) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const objetivos = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(ES_PUBLICO, objetivos)) return true;

    const req = ctx.switchToHttp().getRequest();
    const [tipo, token] = (req.headers.authorization ?? '').split(' ');
    if (tipo !== 'Bearer' || !token) throw new UnauthorizedException('Debes iniciar sesión.');

    let p: { sub: string; v?: number };
    try {
      p = await this.jwt.verifyAsync(token);
    } catch {
      throw new UnauthorizedException('La sesión expiró. Vuelve a iniciar sesión.');
    }
    const [u] = await this.ds.query(
      `SELECT id, email, nombre_completo, rol, activo, sesion_version FROM usuarios WHERE id = $1`,
      [p.sub],
    );
    if (!u || !u.activo || u.sesion_version !== (p.v ?? 0)) {
      throw new UnauthorizedException('La sesión ya no es válida. Vuelve a iniciar sesión.');
    }
    req.usuario = { id: u.id, email: u.email, nombre: u.nombre_completo, rol: u.rol };

    if (u.rol === 'LECTOR') {
      if (this.reflector.getAllAndOverride<boolean>(SOLO_EQUIPO, objetivos)) {
        throw new ForbiddenException('Esta sección es solo para el equipo de la fundación.');
      }
      const consulta = req.method === 'GET' || req.method === 'HEAD';
      if (!consulta && !this.reflector.getAllAndOverride<boolean>(PERMITE_LECTOR, objetivos)) {
        throw new ForbiddenException('Tu cuenta es de solo lectura: puedes consultar, pero no modificar datos.');
      }
    }
    return true;
  }
}
