import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';

export const ES_PUBLICO = 'esPublico';
/** Marca un endpoint como accesible sin iniciar sesión. */
export const Publico = () => SetMetadata(ES_PUBLICO, true);

export type Rol = 'EQUIPO' | 'LECTOR';

/**
 * Los usuarios LECTOR solo pueden hacer consultas (GET). Esta marca permite
 * además un endpoint que modifica algo propio del lector (su perfil, su clave).
 */
export const PERMITE_LECTOR = 'permiteLector';
export const PermitirLector = () => SetMetadata(PERMITE_LECTOR, true);

/** Solo para el equipo, incluso si es una consulta (ej. administrar usuarios). */
export const SOLO_EQUIPO = 'soloEquipo';
export const SoloEquipo = () => SetMetadata(SOLO_EQUIPO, true);

export interface UsuarioSesion {
  id: string;
  email: string;
  nombre: string;
  rol: Rol;
}

/** Inyecta el usuario que hizo la petición (viene del token y de la base). */
export const Usuario = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): UsuarioSesion => ctx.switchToHttp().getRequest().usuario,
);
