import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { AvanceService } from './avance.service';
import { Usuario, UsuarioSesion } from '../auth/public.decorator';
import { ExcelService } from '../common/excel.service';
import { CommonModule } from '../common/common.module';

class RequisitoDto {
  @IsString() @MinLength(1) @MaxLength(150) nombre: string;
}
class CumplidoDto {
  @IsBoolean() cumplido: boolean;
}
class ResultadoDto {
  @ValidateIf((o) => o.resultado !== null)
  @IsIn(['PASA', 'NO_PASA'])
  resultado: 'PASA' | 'NO_PASA' | null;
}
class ConfirmarDto {
  @IsOptional() @IsArray() @ArrayMaxSize(2000) @IsUUID('all', { each: true })
  postulacionIds?: string[];
}
class EntrevistaDto {
  @IsBoolean() realizada: boolean;
  @IsOptional() @ValidateIf((o) => o.fechaHora !== null) @IsISO8601()
  fechaHora?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) comentario?: string;
}

@ApiTags('avance')
@ApiBearerAuth()
@Controller('avance/:etapaId')
export class AvanceController {
  constructor(
    private readonly svc: AvanceService,
    private readonly excelService: ExcelService,
  ) {}

  @Get()
  vista(@Param('etapaId', ParseUUIDPipe) etapaId: string) {
    return this.svc.vista(etapaId);
  }

  @Get('exportar')
  async exportarExcelEtapa(
    @Param('etapaId', ParseUUIDPipe) etapaId: string,
    @Res() res: Response,
  ) {
    try {
      const datosVista = await this.svc.vista(etapaId);
      const datosAExportar = Array.isArray(datosVista)
        ? datosVista
        : (datosVista as any).postulantes || [datosVista];

      const nombreArchivo = `Reporte_Etapa_${etapaId}`;
      await this.excelService.exportarDatosEtapa(datosAExportar, res, nombreArchivo);
    } catch (error) {
      console.error('Error exportando excel:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Falló la generación del Excel' });
      }
    }
  }

  @Put('estudiantes/:postulacionId/requisitos/:requisitoId')
  requisito(
    @Param('etapaId', ParseUUIDPipe) etapaId: string,
    @Param('postulacionId', ParseUUIDPipe) postulacionId: string,
    @Param('requisitoId', ParseUUIDPipe) requisitoId: string,
    @Body() dto: CumplidoDto,
    @Usuario() u: UsuarioSesion,
  ) {
    return this.svc.marcarRequisito(etapaId, postulacionId, requisitoId, dto.cumplido, u.id);
  }

  @Put('estudiantes/:postulacionId/resultado')
  resultado(
    @Param('etapaId', ParseUUIDPipe) etapaId: string,
    @Param('postulacionId', ParseUUIDPipe) postulacionId: string,
    @Body() dto: ResultadoDto,
    @Usuario() u: UsuarioSesion,
  ) {
    return this.svc.marcar(etapaId, postulacionId, dto.resultado, u.id);
  }

  @Post('sugerir-desde-confirmacion')
  @HttpCode(200)
  sugerir(
    @Param('etapaId', ParseUUIDPipe) etapaId: string,
    @Usuario() u: UsuarioSesion,
  ) {
    return this.svc.sugerirDesdeConfirmacion(etapaId, u.id);
  }

  @Put('estudiantes/:postulacionId/entrevista')
  entrevista(
    @Param('etapaId', ParseUUIDPipe) etapaId: string,
    @Param('postulacionId', ParseUUIDPipe) postulacionId: string,
    @Body() dto: EntrevistaDto,
    @Usuario() u: UsuarioSesion,
  ) {
    return this.svc.marcarEntrevista(
      etapaId,
      postulacionId,
      dto.realizada,
      dto.fechaHora,
      dto.comentario,
      u.id,
    );
  }

  @Post('confirmar')
  @HttpCode(200)
  confirmar(
    @Param('etapaId', ParseUUIDPipe) etapaId: string,
    @Body() dto: ConfirmarDto,
    @Usuario() u: UsuarioSesion,
  ) {
    return this.svc.confirmar(etapaId, dto.postulacionIds, u.id);
  }

  @Post('estudiantes/:postulacionId/deshacer')
  @HttpCode(200)
  deshacer(
    @Param('etapaId', ParseUUIDPipe) etapaId: string,
    @Param('postulacionId', ParseUUIDPipe) postulacionId: string,
    @Usuario() u: UsuarioSesion,
  ) {
    return this.svc.deshacer(etapaId, postulacionId, u.id);
  }

  @Post('requisitos')
  crearRequisito(
    @Param('etapaId', ParseUUIDPipe) etapaId: string,
    @Body() dto: RequisitoDto,
    @Usuario() u: UsuarioSesion,
  ) {
    return this.svc.crearRequisito(etapaId, dto.nombre, u.id);
  }

  @Patch('requisitos/:requisitoId')
  renombrarRequisito(
    @Param('etapaId', ParseUUIDPipe) etapaId: string,
    @Param('requisitoId', ParseUUIDPipe) requisitoId: string,
    @Body() dto: RequisitoDto,
  ) {
    return this.svc.renombrarRequisito(etapaId, requisitoId, dto.nombre);
  }

  @Delete('requisitos/:requisitoId')
  quitarRequisito(
    @Param('etapaId', ParseUUIDPipe) etapaId: string,
    @Param('requisitoId', ParseUUIDPipe) requisitoId: string,
    @Usuario() u: UsuarioSesion,
  ) {
    return this.svc.quitarRequisito(etapaId, requisitoId, u.id);
  }
}

@Module({
  imports: [CommonModule],
  controllers: [AvanceController],
  providers: [AvanceService],
  exports: [AvanceService],
})
export class AvanceModule {}