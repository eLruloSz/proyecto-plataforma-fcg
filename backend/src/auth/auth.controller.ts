import { Body, Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { AuthService } from './auth.service';
import { Publico, Usuario, UsuarioSesion } from './public.decorator';

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
  @IsString() @MinLength(10, { message: 'La nueva contraseña debe tener al menos 10 caracteres.' }) nueva: string;
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

  @Get('yo')
  yo(@Usuario() u: UsuarioSesion) {
    return this.auth.perfil(u.id);
  }

  @Patch('yo')
  actualizar(@Usuario() u: UsuarioSesion, @Body() dto: PerfilDto) {
    return this.auth.actualizarPerfil(u.id, dto);
  }

  @Post('yo/password')
  @HttpCode(200)
  password(@Usuario() u: UsuarioSesion, @Body() dto: PasswordDto) {
    return this.auth.cambiarPassword(u.id, dto.actual, dto.nueva);
  }
}
