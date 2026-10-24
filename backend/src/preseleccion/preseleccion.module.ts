import {
  Body, Controller, Delete, Get, HttpCode, Module, Param, ParseUUIDPipe, Post, Put, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import {
  IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, Max, MaxLength, Min, ValidateIf,
} from 'class-validator';
import { PreseleccionService } from './preseleccion.service';
import { Usuario, UsuarioSesion } from '../auth/public.decorator';
import { TAMANO_MAXIMO } from '../common/archivos.service';

const subida = FileInterceptor('archivo', { limits: { fileSize: TAMANO_MAXIMO } });

/** Personas: entero 0–30 o null (sin dato). */
const Personas = (min = 0) => (target: object, key: string) => {
  IsOptional()(target, key);
  ValidateIf((o) => o[key] !== null)(target, key);
  IsInt()(target, key);
  Min(min)(target, key);
  Max(30)(target, key);
};

class FichaDto {
  @IsOptional() @ValidateIf((o) => o.tramoRsh !== null) @IsIn([40, 50, 60, 70, 80, 90, 100], { message: 'El tramo del RSH debe ser 40, 50, 60, 70, 80, 90 o 100.' }) tramoRsh?: number | null;
  @IsOptional() @IsBoolean() rshPendiente?: boolean;
  @IsOptional() @ValidateIf((o) => o.rshActualizada !== null) @IsISO8601() rshActualizada?: string | null;
  @Personas(1) personasHogar?: number | null;
  @Personas() menores18?: number | null;
  @Personas() mayores60?: number | null;
  @Personas() conDiscapacidad?: number | null;
  @Personas() conDependencia?: number | null;
  @Personas() conInvalidez?: number | null;
  @Personas() conNee?: number | null;
  @IsOptional() @ValidateIf((o) => o.ingresosHogar !== null) @IsString() @MaxLength(120) ingresosHogar?: string | null;
  @Personas(1) personasFormulario?: number | null;
  @IsOptional() @ValidateIf((o) => o.observaciones !== null) @IsString() @MaxLength(4000) observaciones?: string | null;
}

class MarcarRankingDto {
  @IsIn(['finalistas', 'primeros']) criterio: 'finalistas' | 'primeros';
  @IsOptional() @IsInt() @Min(1) @Max(2000) n?: number;
}

@ApiTags('preseleccion')
@ApiBearerAuth()
@Controller()
export class PreseleccionController {
  constructor(private readonly svc: PreseleccionService) {}

  /** Ficha de postulación (datos de la cartola RSH que digita la fundación). */
  @Put('postulaciones/:id/ficha')
  ficha(@Param('id', ParseUUIDPipe) id: string, @Body() dto: FichaDto, @Usuario() u: UsuarioSesion) {
    return this.svc.guardarFicha(id, dto, u.id);
  }

  @Get('ranking')
  ranking() {
    return this.svc.estado();
  }

  /** Paso 1: subir el Excel del ranking y ver cómo se cruza con los invitados (no guarda). */
  @Post('ranking/previsualizar')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(subida)
  previsualizar(@UploadedFile() archivo: Express.Multer.File, @Body('hoja') hoja?: string) {
    return this.svc.previsualizar(archivo, hoja || undefined);
  }

  /** Paso 2: guardar el ranking (se vuelve a enviar el archivo; reemplaza al anterior). */
  @Post('ranking')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(subida)
  cargar(@UploadedFile() archivo: Express.Multer.File, @Body('hoja') hoja: string | undefined, @Usuario() u: UsuarioSesion) {
    return this.svc.confirmar(archivo, hoja || undefined, u.id);
  }

  @Delete('ranking')
  eliminar(@Usuario() u: UsuarioSesion) {
    return this.svc.eliminar(u.id);
  }

  /** Marca pasa / no pasa en la etapa según el ranking (finalistas o los N primeros). */
  @Post('avance/:etapaId/marcar-segun-ranking')
  @HttpCode(200)
  marcar(@Param('etapaId', ParseUUIDPipe) etapaId: string, @Body() dto: MarcarRankingDto, @Usuario() u: UsuarioSesion) {
    return this.svc.marcarSegunRanking(etapaId, dto.criterio, dto.n, u.id);
  }
}

@Module({ controllers: [PreseleccionController], providers: [PreseleccionService] })
export class PreseleccionModule {}