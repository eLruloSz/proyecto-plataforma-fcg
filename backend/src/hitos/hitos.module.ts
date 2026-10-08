import { Body, Controller, Get, Global, Module, NotFoundException, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { DataSource } from 'typeorm';
import { HitosService } from './hitos.service';
import { ProcesoActualService } from '../common/proceso-actual.service';
import { Usuario, UsuarioSesion } from '../auth/public.decorator';

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
