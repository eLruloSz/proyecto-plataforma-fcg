import {
  Body, ConflictException, Controller, Delete, Get, HttpCode, Injectable, Module, NotFoundException, Param,
  ParseIntPipe, Post, Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested,
} from 'class-validator';
import { DataSource } from 'typeorm';
import { AuditoriaService } from '../common/auditoria.service';
import { Usuario, UsuarioSesion } from '../auth/public.decorator';
import { ResumenGeneracion, ResumenGeneracionService } from './resumen.service';

// ---------------------------------------------------------------------------
// Generación histórica (años anteriores al sistema, ingresados a mano)
// ---------------------------------------------------------------------------
class EtapaHistoricaDto {
  @IsString() @MinLength(1) @MaxLength(150) nombre: string;
  /** Cuántos estudiantes llegaron a esta etapa. Vacío = sin dato. */
  @IsOptional() @IsInt() @Min(0) llegaron?: number | null;
}
class BecarioHistoricoDto {
  @IsString() @MinLength(1) @MaxLength(200) nombre: string;
  @IsOptional() @IsString() @MaxLength(200) liceo?: string | null;
}
class GeneracionHistoricaDto {
  @IsInt({ message: 'El año debe ser un número.' }) @Min(2000) @Max(2100) anio: number;
  @IsOptional() @IsInt() @Min(0) liceos?: number | null;
  @IsOptional() @IsInt() @Min(0) invitados?: number | null;
  @IsOptional() @IsInt() @Min(0) aceptaron?: number | null;
  @IsOptional() @IsInt() @Min(0) becarios?: number | null;
  @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => EtapaHistoricaDto)
  etapas: EtapaHistoricaDto[];
  @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => BecarioHistoricoDto)
  listaBecarios: BecarioHistoricoDto[];
  @IsOptional() @IsString() @MaxLength(2000) observaciones?: string | null;
}

interface FilaProceso {
  id: string; nombre: string; anio: number; estado: 'ACTIVO' | 'CERRADO'; historico: boolean;
  creado_en: string; cerrado_en: string | null; observaciones: string | null; resumen: ResumenGeneracion | null;
}

const nombreGeneracion = (anio: number) => `Beca Carmen Goudie ${anio}`;

@Injectable()
export class GeneracionesService {
  constructor(
    private readonly ds: DataSource,
    private readonly resumenes: ResumenGeneracionService,
    private readonly auditoria: AuditoriaService,
  ) {}

  /**
   * Tarjetas de "Generaciones": el proceso en curso (con sus números del
   * momento) y los cerrados (con la foto guardada al cerrar). El proceso en
   * preparación no aparece.
   */
  async listar() {
    const filas: FilaProceso[] = await this.ds.query(
      `SELECT id, nombre, anio, estado, historico, creado_en, cerrado_en, observaciones, resumen
         FROM procesos WHERE estado IN ('ACTIVO', 'CERRADO') ORDER BY anio DESC`);
    const lista = [];
    for (const f of filas) {
      const r = await this.resumenDe(f);
      lista.push({
        ...this.cabecera(f),
        resumen: r && {
          liceos: r.liceos, invitados: r.invitados, aceptaron: r.aceptaron, becarios: r.becarios, etapas: r.etapas,
        },
      });
    }
    return lista;
  }

  /** Detalle de una generación (solo lectura). */
  async detalle(anio: number) {
    const f = await this.buscar(anio);
    return { ...this.cabecera(f), resumen: await this.resumenDe(f) };
  }

  async crearHistorica(dto: GeneracionHistoricaDto, usuarioId: string) {
    await this.verificarAnioLibre(dto.anio);
    const [p] = await this.ds.query(
      `INSERT INTO procesos (nombre, anio, estado, historico, resumen, observaciones)
       VALUES ($1, $2, 'CERRADO', TRUE, $3, $4) RETURNING id`,
      [nombreGeneracion(dto.anio), dto.anio, JSON.stringify(this.resumenManual(dto)), dto.observaciones?.trim() || null]);
    await this.auditoria.registrar(usuarioId, 'CREAR_GENERACION_HISTORICA', 'procesos', p.id, { anio: dto.anio });
    return this.detalle(dto.anio);
  }

  /** Solo las generaciones ingresadas a mano se pueden corregir; las del sistema no. */
  async editarHistorica(anio: number, dto: GeneracionHistoricaDto, usuarioId: string) {
    const f = await this.buscarHistorica(anio);
    if (dto.anio !== anio) await this.verificarAnioLibre(dto.anio);
    await this.ds.query(
      `UPDATE procesos SET anio = $2, nombre = $3, resumen = $4, observaciones = $5 WHERE id = $1`,
      [f.id, dto.anio, nombreGeneracion(dto.anio), JSON.stringify(this.resumenManual(dto)), dto.observaciones?.trim() || null]);
    await this.auditoria.registrar(usuarioId, 'EDITAR_GENERACION_HISTORICA', 'procesos', f.id, { anio: dto.anio });
    return this.detalle(dto.anio);
  }

  async eliminarHistorica(anio: number, usuarioId: string) {
    const f = await this.buscarHistorica(anio);
    await this.ds.query(`DELETE FROM procesos WHERE id = $1`, [f.id]);
    await this.auditoria.registrar(usuarioId, 'ELIMINAR_GENERACION_HISTORICA', 'procesos', f.id, { anio });
  }

  // -------------------------------------------------------------------------

  private cabecera(f: FilaProceso) {
    return {
      anio: f.anio, nombre: f.nombre, estado: f.estado, historico: f.historico,
      inicio: f.historico ? null : f.creado_en, cerrado_en: f.cerrado_en, observaciones: f.observaciones,
    };
  }

  /**
   * En curso: se calcula en el momento. Cerrado: se usa la foto guardada; si
   * el proceso se cerró antes de que existiera el histórico, se calcula y se
   * guarda la primera vez.
   */
  private async resumenDe(f: FilaProceso): Promise<ResumenGeneracion | null> {
    if (f.estado === 'ACTIVO') return this.resumenes.calcular(f.id);
    if (f.resumen || f.historico) return f.resumen;
    return this.resumenes.guardar(f.id);
  }

  private async buscar(anio: number): Promise<FilaProceso> {
    const [f] = await this.ds.query(
      `SELECT id, nombre, anio, estado, historico, creado_en, cerrado_en, observaciones, resumen
         FROM procesos WHERE anio = $1 AND estado IN ('ACTIVO', 'CERRADO')`, [anio]);
    if (!f) throw new NotFoundException(`No hay una generación ${anio}.`);
    return f;
  }

  private async buscarHistorica(anio: number): Promise<FilaProceso> {
    const f = await this.buscar(anio);
    if (!f.historico) throw new ConflictException('Esta generación fue registrada por el sistema y no se puede modificar.');
    return f;
  }

  private async verificarAnioLibre(anio: number) {
    const [otro] = await this.ds.query(`SELECT 1 FROM procesos WHERE anio = $1`, [anio]);
    if (otro) throw new ConflictException(`Ya existe una generación del año ${anio}.`);
  }

  private resumenManual(dto: GeneracionHistoricaDto): ResumenGeneracion {
    const lista = dto.listaBecarios
      .map((b) => ({ codigo: null, nombre: b.nombre.trim(), liceo: b.liceo?.trim() || null }))
      .filter((b) => b.nombre);
    return {
      version: 1,
      calculado_en: new Date().toISOString(),
      liceos: { convocados: dto.liceos ?? null, con_invitados: null },
      invitados: dto.invitados ?? null,
      aceptaron: dto.aceptaron ?? null,
      becarios: dto.becarios ?? (lista.length || null),
      // La etapa 1 (invitación) son los invitados: las demás se numeran desde 2.
      etapas: dto.etapas.map((e, i) => ({
        orden: i + 2, nombre: e.nombre.trim(), cupo: null, llegaron: e.llegaron ?? null, fecha_inicio: null, fecha_fin: null,
      })),
      por_liceo: [],
      lista_becarios: lista,
      material: null,
    };
  }
}

@ApiTags('generaciones')
@ApiBearerAuth()
@Controller('generaciones')
export class GeneracionesController {
  constructor(private readonly svc: GeneracionesService) {}

  @Get()
  listar() {
    return this.svc.listar();
  }

  @Get(':anio')
  detalle(@Param('anio', ParseIntPipe) anio: number) {
    return this.svc.detalle(anio);
  }

  @Post('historicas')
  crearHistorica(@Body() dto: GeneracionHistoricaDto, @Usuario() u: UsuarioSesion) {
    return this.svc.crearHistorica(dto, u.id);
  }

  @Put('historicas/:anio')
  editarHistorica(@Param('anio', ParseIntPipe) anio: number, @Body() dto: GeneracionHistoricaDto, @Usuario() u: UsuarioSesion) {
    return this.svc.editarHistorica(anio, dto, u.id);
  }

  @Delete('historicas/:anio')
  @HttpCode(204)
  eliminarHistorica(@Param('anio', ParseIntPipe) anio: number, @Usuario() u: UsuarioSesion) {
    return this.svc.eliminarHistorica(anio, u.id);
  }
}

@Module({
  controllers: [GeneracionesController],
  providers: [GeneracionesService, ResumenGeneracionService],
  exports: [ResumenGeneracionService],
})
export class GeneracionesModule {}
