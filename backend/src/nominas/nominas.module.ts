import {
  Controller, Delete, DefaultValuePipe, Get, HttpCode, Module, Param, ParseIntPipe, ParseUUIDPipe,
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

  @Get()
  obtener(
    @Param('liceoId', ParseUUIDPipe) liceoId: string,
    @Query('porCurso', new DefaultValuePipe(3), ParseIntPipe) porCurso: number,
  ) {
    return this.svc.obtener(liceoId, Math.max(0, Math.min(porCurso, 50)));
  }

  @Delete()
  eliminar(@Param('liceoId', ParseUUIDPipe) liceoId: string, @Usuario() u: UsuarioSesion) {
    return this.svc.eliminar(liceoId, u.id);
  }
}

@Module({ controllers: [NominasController], providers: [NominasService] })
export class NominasModule {}
