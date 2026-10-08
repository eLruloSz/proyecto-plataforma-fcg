import {
  Body, ConflictException, Controller, Get, Injectable, Module, NotFoundException,
  Param, ParseUUIDPipe, Patch, Post, Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsEmail, IsIn, IsOptional, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';
import { DataSource } from 'typeorm';
import { ProcesoActualService } from '../common/proceso-actual.service';
import { AuditoriaService } from '../common/auditoria.service';
import { Usuario, UsuarioSesion } from '../auth/public.decorator';
import { filas } from '../common/sql';

class LiceoDto {
  @Matches(/^\d{2,4}$/, { message: 'El código debe ser numérico, ej. "01".' }) codigo: string;
  @IsString() @MaxLength(200) nombre: string;
  @IsOptional() @IsString() @MaxLength(100) comuna?: string;
  @IsOptional() @IsString() @MaxLength(500) direccion?: string;
  @IsOptional() @IsString() @MaxLength(60) telefono?: string;
}
class ActualizarLiceoDto {
  @IsOptional() @IsString() @MaxLength(200) nombre?: string;
  @IsOptional() @IsString() @MaxLength(100) comuna?: string;
  @IsOptional() @IsString() @MaxLength(500) direccion?: string;
  @IsOptional() @IsString() @MaxLength(60) telefono?: string;
  @IsOptional() activo?: boolean;
}
class ContactoDto {
  @IsString() @MaxLength(200) nombre: string;
  @IsOptional() @IsString() @MaxLength(150) cargo?: string;
  @ValidateIf((o) => o.email !== null && o.email !== '' && o.email !== undefined)
  @IsEmail({}, { message: 'El email no tiene un formato válido.' })
  email?: string | null;
  @IsOptional() @IsString() @MaxLength(60) telefono?: string;
}
class ParticipacionDto {
  @IsIn(['PENDIENTE', 'PARTICIPA', 'NO_PARTICIPA']) estado: string;
  @IsOptional() @IsString() @MaxLength(2000) observaciones?: string;
}

@Injectable()
export class LiceosService {
  constructor(
    private readonly ds: DataSource,
    private readonly proceso: ProcesoActualService,
    private readonly auditoria: AuditoriaService,
  ) {}

  async listar() {
    const procesoId = await this.proceso.id();
    return this.ds.query(
      `SELECT l.id, l.codigo, l.nombre, l.comuna, l.direccion, l.telefono, l.activo,
              COALESCE(pl.estado, 'PENDIENTE') AS participacion,
              pl.observaciones AS participacion_obs,
              (SELECT row_to_json(c) FROM (SELECT id, nombre, cargo, email, telefono FROM contactos_liceo
                 WHERE liceo_id = l.id AND tipo = 'CONTRAPARTE') c) AS contraparte,
              (SELECT row_to_json(c) FROM (SELECT id, nombre, cargo, email, telefono FROM contactos_liceo
                 WHERE liceo_id = l.id AND tipo = 'DIRECTOR') c) AS director,
              (SELECT row_to_json(n) FROM (
                 SELECT ca.id AS carga_id, ca.nombre_archivo, ca.cargado_en,
                        COUNT(a.id)::int AS alumnos, COUNT(DISTINCT a.curso)::int AS cursos
                   FROM cargas ca JOIN alumnos_nomina a ON a.carga_id = ca.id
                  WHERE ca.liceo_id = l.id AND ca.proceso_id = $1 AND ca.tipo = 'NOMINA_NOTAS'
                  GROUP BY ca.id) n) AS nomina,
              (SELECT COUNT(*)::int FROM postulaciones p WHERE p.liceo_id = l.id AND p.proceso_id = $1) AS invitados
         FROM liceos l
         LEFT JOIN participaciones_liceo pl ON pl.liceo_id = l.id AND pl.proceso_id = $1
        ORDER BY l.codigo`,
      [procesoId],
    );
  }

  async obtener(id: string) {
    const lista = await this.listar();
    const l = lista.find((x: { id: string }) => x.id === id);
    if (!l) throw new NotFoundException('Liceo no encontrado.');
    return l;
  }

  async crear(dto: LiceoDto, usuarioId: string) {
    const [dup] = await this.ds.query(`SELECT 1 FROM liceos WHERE codigo = $1`, [dto.codigo]);
    if (dup) throw new ConflictException(`Ya existe un liceo con el código ${dto.codigo}.`);
    const [l] = await this.ds.query(
      `INSERT INTO liceos (codigo, nombre, comuna, direccion, telefono) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [dto.codigo, dto.nombre, dto.comuna ?? null, dto.direccion ?? null, dto.telefono ?? null],
    );
    await this.ds.query(
      `INSERT INTO participaciones_liceo (proceso_id, liceo_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [await this.proceso.id(), l.id],
    );
    await this.auditoria.registrar(usuarioId, 'CREAR_LICEO', 'liceos', l.id, dto);
    return this.obtener(l.id);
  }

  async actualizar(id: string, dto: ActualizarLiceoDto, usuarioId: string) {
    const r = await this.ds.query(
      `UPDATE liceos SET nombre = COALESCE($2, nombre), comuna = COALESCE($3, comuna),
              direccion = COALESCE($4, direccion), telefono = COALESCE($5, telefono),
              activo = COALESCE($6, activo)
        WHERE id = $1 RETURNING id`,
      [id, dto.nombre ?? null, dto.comuna ?? null, dto.direccion ?? null, dto.telefono ?? null, dto.activo ?? null],
    );
    if (!filas(r).length) throw new NotFoundException('Liceo no encontrado.');
    await this.auditoria.registrar(usuarioId, 'ACTUALIZAR_LICEO', 'liceos', id, dto);
    return this.obtener(id);
  }

  async guardarContacto(liceoId: string, tipo: string, dto: ContactoDto, usuarioId: string) {
    await this.obtener(liceoId);
    await this.ds.query(
      `INSERT INTO contactos_liceo (liceo_id, tipo, nombre, cargo, email, telefono)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (liceo_id, tipo) DO UPDATE
         SET nombre = $3, cargo = $4, email = $5, telefono = $6`,
      [liceoId, tipo, dto.nombre, dto.cargo ?? null, dto.email?.trim() || null, dto.telefono ?? null],
    );
    await this.auditoria.registrar(usuarioId, 'GUARDAR_CONTACTO', 'liceos', liceoId, { tipo, ...dto });
    return this.obtener(liceoId);
  }

  async participacion(liceoId: string, dto: ParticipacionDto, usuarioId: string) {
    await this.obtener(liceoId);
    await this.ds.query(
      `INSERT INTO participaciones_liceo (proceso_id, liceo_id, estado, observaciones)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (proceso_id, liceo_id) DO UPDATE SET estado = $3, observaciones = COALESCE($4, participaciones_liceo.observaciones)`,
      [await this.proceso.id(), liceoId, dto.estado, dto.observaciones ?? null],
    );
    await this.auditoria.registrar(usuarioId, 'PARTICIPACION_LICEO', 'liceos', liceoId, dto);
    return this.obtener(liceoId);
  }
}

@ApiTags('liceos')
@ApiBearerAuth()
@Controller('liceos')
export class LiceosController {
  constructor(private readonly svc: LiceosService) {}

  @Get() listar() { return this.svc.listar(); }

  @Get(':id') obtener(@Param('id', ParseUUIDPipe) id: string) { return this.svc.obtener(id); }

  @Post() crear(@Body() dto: LiceoDto, @Usuario() u: UsuarioSesion) { return this.svc.crear(dto, u.id); }

  @Patch(':id')
  actualizar(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ActualizarLiceoDto, @Usuario() u: UsuarioSesion) {
    return this.svc.actualizar(id, dto, u.id);
  }

  @Put(':id/contraparte')
  contraparte(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ContactoDto, @Usuario() u: UsuarioSesion) {
    return this.svc.guardarContacto(id, 'CONTRAPARTE', dto, u.id);
  }

  @Put(':id/director')
  director(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ContactoDto, @Usuario() u: UsuarioSesion) {
    return this.svc.guardarContacto(id, 'DIRECTOR', dto, u.id);
  }

  @Put(':id/participacion')
  participacion(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ParticipacionDto, @Usuario() u: UsuarioSesion) {
    return this.svc.participacion(id, dto, u.id);
  }
}

@Module({ controllers: [LiceosController], providers: [LiceosService], exports: [LiceosService] })
export class LiceosModule {}
