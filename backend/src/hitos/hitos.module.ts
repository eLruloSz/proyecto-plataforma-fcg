import { Body, Controller, Get, Global, Module, NotFoundException, Param, ParseIntPipe, ParseUUIDPipe, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { DataSource } from 'typeorm';
import { HitosService } from './hitos.service';
import { ProcesoActualService } from '../common/proceso-actual.service';
import { Usuario, UsuarioSesion } from '../auth/public.decorator';
import { tipoEtapa } from '../dashboard/tareas.service';

class MarcarHitoDto {
  @IsBoolean() completado: boolean;
  @IsOptional() @IsString() @MaxLength(2000) observaciones?: string;
}

@ApiTags('hitos')
@ApiBearerAuth()
@Controller('hitos')
export class HitosController {
  constructor(
    private readonly hitos: HitosService,
    private readonly proceso: ProcesoActualService,
    private readonly ds: DataSource,
  ) {}

  @Get()
  async grilla() {
    return this.hitos.grilla(await this.proceso.id());
  }

  /**
   * Cuadro compacto del Inicio: solo los hitos que se trabajan en esa etapa.
   * Fuera de la invitación, solo cuentan los liceos que tienen estudiantes en
   * la etapa. Si la etapa no tiene hitos propios, se muestran todos (todos = true).
   */
  @Get('etapa/:etapaId')
  async deEtapa(@Param('etapaId', ParseUUIDPipe) etapaId: string) {
    const [e] = await this.ds.query(
      `SELECT id, proceso_id, nombre, clave, orden FROM etapas WHERE id = $1`, [etapaId]);
    if (!e) throw new NotFoundException('Etapa no encontrada.');
    const tipo = tipoEtapa(e);
    const propios: { codigo: string }[] = await this.ds.query(
      `SELECT codigo FROM catalogo_hitos WHERE activo AND $1 = ANY(tipos_etapa)`, [tipo]);
    const todos = propios.length === 0;
    const grilla = await this.hitos.grilla(e.proceso_id, {
      codigos: todos ? null : propios.map((h) => h.codigo),
      etapaId: tipo === 'INVITACION' || todos ? undefined : e.id,
    });
    return { etapa: { id: e.id, nombre: e.nombre, tipo }, todos, ...grilla };
  }

  /** Seguimiento de un concurso (en curso o anterior), solo lectura. */
  @Get('concurso/:anio')
  async deConcurso(@Param('anio', ParseIntPipe) anio: number) {
    const [p] = await this.ds.query(
      `SELECT id, estado FROM procesos WHERE anio = $1 AND NOT historico`, [anio]);
    if (!p) throw new NotFoundException(`No hay seguimiento guardado para el concurso ${anio}.`);
    return this.hitos.grilla(p.id, { cerrado: p.estado === 'CERRADO' });
  }

  @Put(':liceoId/:codigo')
  async marcar(
    @Param('liceoId', ParseUUIDPipe) liceoId: string,
    @Param('codigo') codigo: string,
    @Body() dto: MarcarHitoDto,
    @Usuario() u: UsuarioSesion,
  ) {
    const [existe] = await this.ds.query(`SELECT 1 FROM catalogo_hitos WHERE codigo = $1 AND activo`, [codigo]);
    if (!existe) throw new NotFoundException('Hito no encontrado.');
    await this.hitos.marcarManual(await this.proceso.id(), liceoId, codigo, dto.completado, dto.observaciones, u.id);
    return { ok: true };
  }
}

@Global()
@Module({ controllers: [HitosController], providers: [HitosService], exports: [HitosService] })
export class HitosModule {}
