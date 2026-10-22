import {
  Controller, Delete, Get, HttpCode, Module, Param, ParseUUIDPipe,
  Post, Query, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { NominasService } from './nominas.service';
import { Usuario, UsuarioSesion } from '../auth/public.decorator';
import { TAMANO_MAXIMO } from '../common/archivos.service';

const subida = FileInterceptor('archivo', { limits: { fileSize: TAMANO_MAXIMO } });

@ApiTags('nominas')
@ApiBearerAuth()
@Controller('liceos/:liceoId/nomina')
export class NominasController {
  constructor(private readonly svc: NominasService) {}

  /** Paso 1: subir el Excel y ver qué se cargaría (no guarda nada). */
  @Post('previsualizar')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(subida)
  previsualizar(@Param('liceoId', ParseUUIDPipe) liceoId: string, @UploadedFile() archivo: Express.Multer.File) {
    return this.svc.previsualizar(liceoId, archivo);
  }

  /** Paso 2: confirmar la carga (se vuelve a enviar el mismo archivo). */
  @Post()
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(subida)
  confirmar(
    @Param('liceoId', ParseUUIDPipe) liceoId: string,
    @UploadedFile() archivo: Express.Multer.File,
    @Usuario() u: UsuarioSesion,
  ) {
    return this.svc.confirmar(liceoId, archivo, u.id);
  }

  /**
   * Nómina con la sugerencia de invitados:
   *   ?modo=liceo&n=10 → los 10 mejores promedios del liceo (por defecto)
   *   ?modo=curso&n=3  → los 3 mejores de cada curso
   * `?porCurso=3` se sigue aceptando y equivale a modo=curso&n=3.
   */
  @Get()
  obtener(
    @Param('liceoId', ParseUUIDPipe) liceoId: string,
    @Query('n') n?: string,
    @Query('modo') modo?: string,
    @Query('porCurso') porCurso?: string,
  ) {
    const entero = (s: string | undefined, def: number) => {
      const v = Number.parseInt(s ?? '', 10);
      return Number.isFinite(v) ? Math.max(0, Math.min(v, 200)) : def;
    };
    if (porCurso !== undefined && n === undefined) return this.svc.obtener(liceoId, entero(porCurso, 3), 'curso');
    const m = modo === 'curso' ? 'curso' : 'liceo';
    return this.svc.obtener(liceoId, entero(n, m === 'curso' ? 3 : 10), m);
  }

  @Delete()
  eliminar(@Param('liceoId', ParseUUIDPipe) liceoId: string, @Usuario() u: UsuarioSesion) {
    return this.svc.eliminar(liceoId, u.id);
  }
}

@Module({ controllers: [NominasController], providers: [NominasService] })
export class NominasModule {}