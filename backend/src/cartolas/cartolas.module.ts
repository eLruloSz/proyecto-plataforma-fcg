import {
  Body, Controller, Get, Module, ParseUUIDPipe, Post, Query, UploadedFiles, UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsUUID, Matches } from 'class-validator';
import { CartolasService } from './cartolas.service';
import { SoloEquipo, Usuario, UsuarioSesion } from '../auth/public.decorator';

/** Una cartola real pesa unos cientos de KB. Máximo de archivos por envío: el front manda de a 5 (nginx acepta 12 MB por envío). */
const ARCHIVOS_POR_ENVIO = 5;
const TAMANO_MAXIMO_PDF = 2 * 1024 * 1024;
const subida = FilesInterceptor('archivos', ARCHIVOS_POR_ENVIO, { limits: { fileSize: TAMANO_MAXIMO_PDF } });

class RegistroDto {
  @IsUUID() postulacionId: string;
  @Matches(/^[0-9a-f]{64}$/, { message: 'La huella del archivo no es válida.' }) hash: string;
  @IsOptional() @IsISO8601() emitidaEn?: string | null;
}

/** Solo el equipo: las cuentas de solo lectura no suben ni leen cartolas. */
@ApiTags('cartolas')
@ApiBearerAuth()
@SoloEquipo()
@Controller('cartolas')
export class CartolasController {
  constructor(private readonly svc: CartolasService) {}

  /**
   * Lee los PDF y devuelve lo que encontró. No guarda nada: ni los archivos ni la ficha.
   * Con `?postulacionId=` compara la cartola con ese estudiante (nombre y RUT) en vez de buscarlo entre todos.
   */
  @Post('leer')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(subida)
  leer(@UploadedFiles() archivos: Express.Multer.File[], @Query('postulacionId', new ParseUUIDPipe({ optional: true })) postulacionId?: string) {
    return this.svc.leer(archivos, postulacionId);
  }

  /** Estado de la ficha RSH de cada estudiante de Preselección N°1 (qué tiene y si hay cartola leída). */
  @Get('estado')
  estado() {
    return this.svc.listado();
  }

  @Get('estudiantes')
  estudiantes(@Query('q') q?: string) {
    return this.svc.estudiantes(q);
  }

  /** Constancia de que la cartola se cargó (después de guardar la ficha con PUT /postulaciones/:id/ficha). */
  @Post('registro')
  registro(@Body() dto: RegistroDto, @Usuario() u: UsuarioSesion) {
    return this.svc.registrar(dto.postulacionId, dto.hash, dto.emitidaEn, u.id);
  }
}

@Module({ controllers: [CartolasController], providers: [CartolasService] })
export class CartolasModule {}
