import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';

export const ES_PUBLICO = 'esPublico';
/** Marca un endpoint como accesible sin iniciar sesión. */
export const Publico = () => SetMetadata(ES_PUBLICO, true);

export interface UsuarioSesion {
  id: string;
  email: string;
  nombre: string;
}

/** Inyecta el usuario que hizo la petición (viene del token). */
export const Usuario = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): UsuarioSesion => ctx.switchToHttp().getRequest().usuario,
);
