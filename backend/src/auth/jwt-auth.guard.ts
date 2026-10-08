import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ES_PUBLICO } from './public.decorator';

/** Todos los endpoints requieren sesión salvo los marcados con @Publico(). */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly jwt: JwtService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const publico = this.reflector.getAllAndOverride<boolean>(ES_PUBLICO, [ctx.getHandler(), ctx.getClass()]);
    if (publico) return true;

    const req = ctx.switchToHttp().getRequest();
    const [tipo, token] = (req.headers.authorization ?? '').split(' ');
    if (tipo !== 'Bearer' || !token) throw new UnauthorizedException('Debes iniciar sesión.');
    try {
      const p = await this.jwt.verifyAsync(token);
      req.usuario = { id: p.sub, email: p.email, nombre: p.nombre };
      return true;
    } catch {
      throw new UnauthorizedException('La sesión expiró. Vuelve a iniciar sesión.');
    }
  }
}
