import {
  Body, Controller, Delete, Get, HttpCode, Module, Param, ParseUUIDPipe, Patch, Post, Query, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayNotEmpty, IsArray, IsBoolean, IsEmail, IsIn, IsISO8601, IsOptional, IsString, IsUrl, IsUUID,
  MaxLength, MinLength, ValidateIf, ValidateNested,
} from 'class-validator';
import { InvitadosService } from './invitados.service';
import { ImportarContactosService } from './importar-contactos.service';
import { TAMANO_MAXIMO } from '../common/archivos.service';
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
class CambioContactoDto {
  @IsUUID() invitadoId: string;
  @IsOptional() @ValidateIf((o) => o.email !== null) @IsString() @MaxLength(255) email?: string | null;
  @IsOptional() @ValidateIf((o) => o.telefono !== null) @IsString() @MaxLength(60) telefono?: string | null;
  @IsOptional() @ValidateIf((o) => o.rut !== null) @IsString() @MaxLength(15) rut?: string | null;
}
class ImportarContactosDto {
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(2000) @ValidateNested({ each: true }) @Type(() => CambioContactoDto)
  cambios: CambioContactoDto[];
}
class EncuentroDto {
  @IsISO8601() fecha: string;
  @IsOptional() @ValidateIf((o) => o.enlace !== null && o.enlace !== '') @IsUrl({}, { message: 'El enlace no es una dirección válida.' }) @MaxLength(500)
  enlace?: string | null;
}
class ComentarioDto {
  @IsString() @MinLength(1) @MaxLength(4000) texto: string;
}

@ApiTags('invitados')
@ApiBearerAuth()
@Controller()
export class InvitadosController {
  constructor(private readonly svc: InvitadosService, private readonly importar: ImportarContactosService) {}

  /**
   * Excel de respuestas del formulario (Microsoft Forms): muestra a qué invitado
   * corresponde cada respuesta y qué datos cambiarían. No guarda nada.
   * `mapeo` (opcional, JSON) fija las columnas: {"nombre":5,"rut":7,"email":8,...}
   */
  @Post('invitados/importar-contactos/previsualizar')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('archivo', { limits: { fileSize: TAMANO_MAXIMO } }))
  previsualizarContactos(@UploadedFile() archivo: Express.Multer.File, @Body('mapeo') mapeo?: string) {
    return this.importar.previsualizar(archivo, mapeo);
  }

  /** Guarda los datos de contacto elegidos en la revisión. */
  @Post('invitados/importar-contactos')
  @HttpCode(200)
  confirmarContactos(@Body() dto: ImportarContactosDto, @Usuario() u: UsuarioSesion) {
    return this.importar.confirmar(dto.cambios, u.id);
  }

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

  @Post('encuentros')
  crearEncuentro(@Body() dto: EncuentroDto, @Usuario() u: UsuarioSesion) {
    return this.svc.crearEncuentro(dto.fecha, dto.enlace, u.id);
  }

  @Delete('encuentros/:id')
  eliminarEncuentro(@Param('id', ParseUUIDPipe) id: string, @Usuario() u: UsuarioSesion) {
    return this.svc.eliminarEncuentro(id, u.id);
  }
}

@Module({ controllers: [InvitadosController], providers: [InvitadosService, ImportarContactosService] })
export class InvitadosModule {}