import { Body, Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { AuthService } from './auth.service';
import { PermitirLector, Publico, Usuario, UsuarioSesion } from './public.decorator';

const MENSAJE_LARGO = 'La nueva contraseña debe tener al menos 10 caracteres.';

class LoginDto {
  @IsEmail() email: string;
  @IsString() @MinLength(1) password: string;
}
class PerfilDto {
  @IsOptional() @IsString() @MaxLength(200) nombre?: string;
  @IsOptional() @IsString() @MaxLength(2000) firma?: string;
}
class PasswordDto {
  @IsString() actual: string;
  @IsString() @MinLength(10, { message: MENSAJE_LARGO }) @MaxLength(200) nueva: string;
}
class OlvideDto {
  @IsEmail({}, { message: 'Ingresa un correo válido.' }) @MaxLength(255) email: string;
}
class TokenDto {
  @IsString() @MaxLength(100) token: string;
}
class UsarEnlaceDto {
  @IsString() @MaxLength(100) token: string;
  @IsString() @MinLength(10, { message: MENSAJE_LARGO }) @MaxLength(200) password: string;
  @IsOptional() @IsString() @MaxLength(200) nombre?: string;
}

@ApiTags('auth')
@ApiBearerAuth()
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Publico()
  @Throttle({ default: { limit: 10, ttl: 60_000 } }) // 10 intentos por minuto
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password);
  }

  /** "¿Olvidaste tu contraseña?" — limitado para que no se use para mandar correos masivos. */
  @Publico()
  @Throttle({ default: { limit: 5, ttl: 15 * 60_000 } }) // 5 por cada 15 minutos
  @Post('olvide')
  @HttpCode(200)
  olvide(@Body() dto: OlvideDto) {
    return this.auth.solicitarRestablecimiento(dto.email);
  }

  @Publico()
  @Throttle({ default: { limit: 20, ttl: 15 * 60_000 } })
  @Post('enlace/ver')
  @HttpCode(200)
  verEnlace(@Body() dto: TokenDto) {
    return this.auth.verEnlace(dto.token);
  }

  @Publico()
  @Throttle({ default: { limit: 10, ttl: 15 * 60_000 } })
  @Post('enlace/usar')
  @HttpCode(200)
  usarEnlace(@Body() dto: UsarEnlaceDto) {
    return this.auth.usarEnlace(dto.token, dto.password, dto.nombre);
  }

  @Get('yo')
  yo(@Usuario() u: UsuarioSesion) {
    return this.auth.perfil(u.id);
  }

  @PermitirLector()
  @Patch('yo')
  actualizar(@Usuario() u: UsuarioSesion, @Body() dto: PerfilDto) {
    return this.auth.actualizarPerfil(u.id, dto);
  }

  @PermitirLector()
  @Post('yo/password')
  @HttpCode(200)
  password(@Usuario() u: UsuarioSesion, @Body() dto: PasswordDto) {
    return this.auth.cambiarPassword(u.id, dto.actual, dto.nueva);
  }
}
