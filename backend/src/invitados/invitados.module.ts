import { Body, Controller, Delete, Get, Module, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  ArrayMaxSize, ArrayNotEmpty, IsArray, IsBoolean, IsEmail, IsIn, IsOptional, IsString, IsUUID,
  MaxLength, MinLength, ValidateIf,
} from 'class-validator';
import { InvitadosService } from './invitados.service';
import { Usuario, UsuarioSesion } from '../auth/public.decorator';

class InvitarDto {
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(500) @IsUUID('all', { each: true }) alumnoIds: string[];
}
class ActualizarInvitadoDto {
  @IsOptional() @ValidateIf((o) => o.email !== null && o.email !== '')
  @IsEmail({}, { message: 'El email no tiene un formato válido.' }) email?: string | null;
  @IsOptional() @IsString() @MaxLength(60) telefono?: string | null;
  @IsOptional() @IsString() @MaxLength(15) rut?: string | null;
  @IsOptional() @IsIn(['PENDIENTE', 'CONFIRMADO', 'RECHAZADO']) confirmacion?: 'PENDIENTE' | 'CONFIRMADO' | 'RECHAZADO';
  @IsOptional() @ValidateIf((o) => o.encuentroEventoId !== null) @IsUUID() encuentroEventoId?: string | null;
  @IsOptional() @ValidateIf((o) => o.asistioEncuentro !== null) @IsBoolean() asistioEncuentro?: boolean | null;
}
class ComentarioDto {
  @IsString() @MinLength(1) @MaxLength(4000) texto: string;
}

@ApiTags('invitados')
@ApiBearerAuth()
@Controller()
export class InvitadosController {
  constructor(private readonly svc: InvitadosService) {}

  @Post('invitados')
  invitar(@Body() dto: InvitarDto, @Usuario() u: UsuarioSesion) {
    return this.svc.invitar(dto.alumnoIds, u.id);
  }

  @Get('invitados')
  listar(@Query('liceoId') liceoId?: string, @Query('confirmacion') confirmacion?: string, @Query('q') q?: string) {
    return this.svc.listar({ liceoId, confirmacion, q });
  }

  @Patch('invitados/:id')
  actualizar(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ActualizarInvitadoDto, @Usuario() u: UsuarioSesion) {
    return this.svc.actualizar(id, dto, u.id);
  }

  @Delete('invitados/:id')
  eliminar(@Param('id', ParseUUIDPipe) id: string, @Usuario() u: UsuarioSesion) {
    return this.svc.eliminar(id, u.id);
  }

  @Get('invitados/:id/comentarios')
  comentarios(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.comentarios(id);
  }

  @Post('invitados/:id/comentarios')
  comentar(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ComentarioDto, @Usuario() u: UsuarioSesion) {
    return this.svc.comentar(id, dto.texto, u.id);
  }

  @Get('encuentros')
  encuentros() {
    return this.svc.encuentros();
  }
}

@Module({ controllers: [InvitadosController], providers: [InvitadosService] })
export class InvitadosModule {}
