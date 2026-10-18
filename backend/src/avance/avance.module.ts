import { Body, Controller, Delete, Get, HttpCode, Module, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsISO8601, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { AvanceService } from './avance.service';
import { Usuario, UsuarioSesion } from '../auth/public.decorator';

class RequisitoDto { @IsString() @MinLength(1) @MaxLength(150) nombre: string; }
class CumplidoDto { @IsBoolean() cumplido: boolean; }
class ResultadoDto {
  @ValidateIf((o) => o.resultado !== null) @IsIn(['PASA', 'NO_PASA']) resultado: 'PASA' | 'NO_PASA' | null;
}
class ConfirmarDto {
  @IsOptional() @IsArray() @ArrayMaxSize(2000) @IsUUID('all', { each: true }) postulacionIds?: string[];
}
class EntrevistaDto {
  @IsBoolean() realizada: boolean;
  @IsOptional() @ValidateIf((o) => o.fechaHora !== null) @IsISO8601() fechaHora?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) comentario?: string;
}

@ApiTags('avance')
@ApiBearerAuth()
@Controller('avance/:etapaId')
export class AvanceController {
  constructor(private readonly svc: AvanceService) {}

  @Get()
  vista(@Param('etapaId', ParseUUIDPipe) etapaId: string) {
    return this.svc.vista(etapaId);
  }

  @Put('estudiantes/:postulacionId/requisitos/:requisitoId')
  requisito(
    @Param('etapaId', ParseUUIDPipe) etapaId: string,
    @Param('postulacionId', ParseUUIDPipe) postulacionId: string,
    @Param('requisitoId', ParseUUIDPipe) requisitoId: string,
    @Body() dto: CumplidoDto, @Usuario() u: UsuarioSesion,
  ) {
    return this.svc.marcarRequisito(etapaId, postulacionId, requisitoId, dto.cumplido, u.id);
  }

  @Put('estudiantes/:postulacionId/resultado')
  resultado(
    @Param('etapaId', ParseUUIDPipe) etapaId: string,
    @Param('postulacionId', ParseUUIDPipe) postulacionId: string,
    @Body() dto: ResultadoDto, @Usuario() u: UsuarioSesion,
  ) {
    return this.svc.marcar(etapaId, postulacionId, dto.resultado, u.id);
  }

  @Post('sugerir-desde-confirmacion')
  @HttpCode(200)
  sugerir(@Param('etapaId', ParseUUIDPipe) etapaId: string, @Usuario() u: UsuarioSesion) {
    return this.svc.sugerirDesdeConfirmacion(etapaId, u.id);
  }

  @Put('estudiantes/:postulacionId/entrevista')
  entrevista(
    @Param('etapaId', ParseUUIDPipe) etapaId: string,
    @Param('postulacionId', ParseUUIDPipe) postulacionId: string,
    @Body() dto: EntrevistaDto, @Usuario() u: UsuarioSesion,
  ) {
    return this.svc.marcarEntrevista(etapaId, postulacionId, dto.realizada, dto.fechaHora, dto.comentario, u.id);
  }

  @Post('confirmar')
  @HttpCode(200)
  confirmar(@Param('etapaId', ParseUUIDPipe) etapaId: string, @Body() dto: ConfirmarDto, @Usuario() u: UsuarioSesion) {
    return this.svc.confirmar(etapaId, dto.postulacionIds, u.id);
  }

  @Post('estudiantes/:postulacionId/deshacer')
  @HttpCode(200)
  deshacer(
    @Param('etapaId', ParseUUIDPipe) etapaId: string,
    @Param('postulacionId', ParseUUIDPipe) postulacionId: string, @Usuario() u: UsuarioSesion,
  ) {
    return this.svc.deshacer(etapaId, postulacionId, u.id);
  }

  @Post('requisitos')
  crearRequisito(@Param('etapaId', ParseUUIDPipe) etapaId: string, @Body() dto: RequisitoDto, @Usuario() u: UsuarioSesion) {
    return this.svc.crearRequisito(etapaId, dto.nombre, u.id);
  }

  @Patch('requisitos/:requisitoId')
  renombrarRequisito(
    @Param('etapaId', ParseUUIDPipe) etapaId: string,
    @Param('requisitoId', ParseUUIDPipe) requisitoId: string, @Body() dto: RequisitoDto,
  ) {
    return this.svc.renombrarRequisito(etapaId, requisitoId, dto.nombre);
  }

  @Delete('requisitos/:requisitoId')
  quitarRequisito(
    @Param('etapaId', ParseUUIDPipe) etapaId: string,
    @Param('requisitoId', ParseUUIDPipe) requisitoId: string, @Usuario() u: UsuarioSesion,
  ) {
    return this.svc.quitarRequisito(etapaId, requisitoId, u.id);
  }
}

@Module({ controllers: [AvanceController], providers: [AvanceService], exports: [AvanceService] })
export class AvanceModule {}