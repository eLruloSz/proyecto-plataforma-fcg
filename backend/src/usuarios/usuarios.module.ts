import { Body, Controller, Get, HttpCode, Module, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { UsuariosService } from './usuarios.service';
import { Rol, SoloEquipo, Usuario, UsuarioSesion } from '../auth/public.decorator';

const ROLES: Rol[] = ['EQUIPO', 'LECTOR'];

class InvitarDto {
  @IsEmail({}, { message: 'Ingresa un correo válido.' }) @MaxLength(255) email: string;
  @IsString() @MinLength(1, { message: 'Ingresa el nombre.' }) @MaxLength(200) nombre: string;
  @IsIn(ROLES) rol: Rol;
}
class ActualizarDto {
  @IsOptional() @IsIn(ROLES) rol?: Rol;
  @IsOptional() @IsBoolean() activo?: boolean;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) nombre?: string;
}

@ApiTags('usuarios')
@ApiBearerAuth()
@SoloEquipo()
@Controller('usuarios')
export class UsuariosController {
  constructor(private readonly usuarios: UsuariosService) {}

  @Get() listar() { return this.usuarios.listar(); }

  @Post()
  invitar(@Body() dto: InvitarDto, @Usuario() u: UsuarioSesion) {
    return this.usuarios.invitar(dto, u);
  }

  @Post(':id/enviar-enlace')
  @HttpCode(200)
  enviarEnlace(@Param('id', ParseUUIDPipe) id: string, @Usuario() u: UsuarioSesion) {
    return this.usuarios.enviarEnlace(id, u);
  }

  @Patch(':id')
  actualizar(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ActualizarDto, @Usuario() u: UsuarioSesion) {
    return this.usuarios.actualizar(id, dto, u);
  }
}

@Module({
  controllers: [UsuariosController],
  providers: [UsuariosService],
})
export class UsuariosModule {}
