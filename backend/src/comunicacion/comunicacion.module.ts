import {
  Body, Controller, Delete, ForbiddenException, Get, HttpCode, Module, Param, ParseUUIDPipe, Patch,
  Post, Query, Res, StreamableFile, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength,
} from 'class-validator';
import { timingSafeEqual } from 'crypto';
import type { Response } from 'express';
import { EnviosService } from './envios.service';
import { PlantillasService } from './plantillas.service';
import { MailerService } from './mailer.service';
import { VARIABLES } from './variables';
import { ArchivosService, TAMANO_MAXIMO } from '../common/archivos.service';
import { Publico, Usuario, UsuarioSesion } from '../auth/public.decorator';

const PROPOSITOS = ['PRESENTACION', 'SOLICITUD_NOTAS', 'SOLICITUD_CONTACTOS', 'INVITACION_ESTUDIANTES', 'AVISO_RESULTADO', 'AGRADECIMIENTO', 'OTRO'];

class PlantillaDto {
  @IsString() @MinLength(1) @MaxLength(200) nombre: string;
  @IsOptional() @IsIn(PROPOSITOS) proposito?: string;
  @IsString() @MinLength(1) @MaxLength(300) asunto: string;
  @IsString() @MinLength(1) @MaxLength(50000) cuerpo: string;
}
class EditarPlantillaDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) nombre?: string;
  @IsOptional() @IsIn(PROPOSITOS) proposito?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(300) asunto?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(50000) cuerpo?: string;
}
class EnvioDto {
  @IsIn(['CONTRAPARTES', 'DIRECTORES', 'LICEO', 'POSTULANTES']) grupo: 'CONTRAPARTES' | 'DIRECTORES' | 'LICEO' | 'POSTULANTES';
  @IsOptional() @IsIn(PROPOSITOS) proposito?: string;
  @IsString() @MinLength(1) @MaxLength(300) asunto: string;
  @IsString() @MinLength(1) @MaxLength(50000) cuerpo: string;
  @IsOptional() @IsUUID() plantillaId?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsUUID('all', { each: true }) adjuntoIds?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(500) @IsUUID('all', { each: true }) liceoIds?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(2000) @IsUUID('all', { each: true }) postulacionIds?: string[];
  @IsOptional() @IsUUID() envioOrigenId?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(2000) @IsUUID('all', { each: true }) excluir?: string[];
}
class AsociarAdjuntoDto {
  @IsUUID() archivoId: string;
}
class RespuestaDto {
  @IsBoolean() respondido: boolean;
  @IsOptional() @IsString() @MaxLength(2000) nota?: string;
  @IsOptional() @IsBoolean() participa?: boolean;
}

const subida = FileInterceptor('archivo', { limits: { fileSize: TAMANO_MAXIMO } });

@ApiTags('comunicacion')
@ApiBearerAuth()
@Controller('comunicacion')
export class ComunicacionController {
  constructor(
    private readonly plantillas: PlantillasService,
    private readonly envios: EnviosService,
    private readonly archivos: ArchivosService,
    private readonly mailer: MailerService,
  ) {}

  @Get('variables')
  variables() {
    return { variables: VARIABLES, modoSimulacion: this.mailer.modoSimulacion };
  }

  // --- Plantillas ---
  @Get('plantillas') listarPlantillas() { return this.plantillas.listar(); }

  @Post('plantillas')
  crearPlantilla(@Body() dto: PlantillaDto, @Usuario() u: UsuarioSesion) { return this.plantillas.crear(dto, u.id); }

  @Patch('plantillas/:id')
  editarPlantilla(@Param('id', ParseUUIDPipe) id: string, @Body() dto: EditarPlantillaDto, @Usuario() u: UsuarioSesion) {
    return this.plantillas.actualizar(id, dto, u.id);
  }

  @Delete('plantillas/:id')
  eliminarPlantilla(@Param('id', ParseUUIDPipe) id: string, @Usuario() u: UsuarioSesion) {
    return this.plantillas.eliminar(id, u.id);
  }

  @Post('plantillas/:id/adjuntos')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(subida)
  adjuntar(@Param('id', ParseUUIDPipe) id: string, @UploadedFile() archivo: Express.Multer.File, @Usuario() u: UsuarioSesion) {
    return this.plantillas.agregarAdjunto(id, archivo, u.id);
  }

  @Post('plantillas/:id/adjuntos-existentes')
  asociarAdjunto(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AsociarAdjuntoDto) {
    return this.plantillas.asociarAdjunto(id, dto.archivoId);
  }

  @Delete('plantillas/:id/adjuntos/:archivoId')
  quitarAdjunto(@Param('id', ParseUUIDPipe) id: string, @Param('archivoId', ParseUUIDPipe) archivoId: string) {
    return this.plantillas.quitarAdjunto(id, archivoId);
  }

  // --- Adjuntos sueltos (para un envío sin plantilla) ---
  @Post('adjuntos')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(subida)
  async subirAdjunto(@UploadedFile() archivo: Express.Multer.File) {
    const a = await this.archivos.guardar(archivo);
    return { id: a.id, nombre: a.nombre_original, tamano: a.tamano_bytes };
  }

  @Get('adjuntos/:id')
  async descargar(@Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response) {
    const a = await this.archivos.obtener(id);
    res.set({
      'Content-Type': a.mime_type ?? 'application/octet-stream',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(a.nombre_original)}`,
    });
    return new StreamableFile(await this.archivos.leer(a));
  }

  // --- Envíos ---
  @Post('envios/previsualizar')
  @HttpCode(200)
  previsualizar(@Body() dto: EnvioDto, @Usuario() u: UsuarioSesion) {
    return this.envios.previsualizar(dto, u.id);
  }

  @Post('envios')
  enviar(@Body() dto: EnvioDto, @Usuario() u: UsuarioSesion) {
    return this.envios.enviar(dto, u.id);
  }

  @Get('envios') listarEnvios() { return this.envios.listar(); }

  @Get('envios/:id') detalle(@Param('id', ParseUUIDPipe) id: string) { return this.envios.detalle(id); }

  @Patch('envios/:id/destinatarios/:destinatarioId')
  marcar(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('destinatarioId', ParseUUIDPipe) destinatarioId: string,
    @Body() dto: RespuestaDto,
    @Usuario() u: UsuarioSesion,
  ) {
    return this.envios.marcarRespuesta(id, destinatarioId, dto, u.id);
  }
}

/**
 * Webhook del proveedor de correo. Se protege con un token en la URL que se
 * configura en el panel del proveedor: /api/webhooks/correo?token=XXXX
 */
@ApiTags('webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly envios: EnviosService, private readonly cfg: ConfigService) {}

  @Publico()
  @Post('correo')
  @HttpCode(200)
  correo(@Query('token') token: string, @Body() cuerpo: unknown) {
    const esperado = this.cfg.get<string>('MAIL_WEBHOOK_TOKEN');
    const ok = esperado && token && token.length === esperado.length &&
      timingSafeEqual(Buffer.from(token), Buffer.from(esperado));
    if (!ok) throw new ForbiddenException();
    return this.envios.eventoProveedor(cuerpo);
  }
}

@Module({
  controllers: [ComunicacionController, WebhooksController],
  providers: [PlantillasService, EnviosService, MailerService],
})
export class ComunicacionModule {}
