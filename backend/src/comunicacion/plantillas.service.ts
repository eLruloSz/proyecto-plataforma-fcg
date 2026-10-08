import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuditoriaService } from '../common/auditoria.service';
import { ArchivosService } from '../common/archivos.service';
import { filas } from '../common/sql';

export interface DatosPlantilla {
  nombre?: string;
  proposito?: string;
  asunto?: string;
  cuerpo?: string;
  activo?: boolean;
}

@Injectable()
export class PlantillasService {
  constructor(
    private readonly ds: DataSource,
    private readonly auditoria: AuditoriaService,
    private readonly archivos: ArchivosService,
  ) {}

  listar() {
    return this.ds.query(
      `SELECT p.*,
              COALESCE(json_agg(json_build_object('id', a.id, 'nombre', a.nombre_original, 'tamano', a.tamano_bytes))
                FILTER (WHERE a.id IS NOT NULL), '[]') AS adjuntos
         FROM plantillas_correo p
         LEFT JOIN plantilla_adjuntos pa ON pa.plantilla_id = p.id
         LEFT JOIN archivos a ON a.id = pa.archivo_id
        WHERE p.activo
        GROUP BY p.id
        ORDER BY p.creado_en`,
    );
  }

  async obtener(id: string) {
    const p = (await this.listar()).find((x: { id: string }) => x.id === id);
    if (!p) throw new NotFoundException('Plantilla no encontrada.');
    return p;
  }

  async crear(d: Required<Pick<DatosPlantilla, 'nombre' | 'asunto' | 'cuerpo'>> & DatosPlantilla, usuarioId: string) {
    const [p] = await this.ds.query(
      `INSERT INTO plantillas_correo (nombre, proposito, asunto, cuerpo) VALUES ($1, $2, $3, $4) RETURNING id`,
      [d.nombre, d.proposito ?? 'OTRO', d.asunto, d.cuerpo]);
    await this.auditoria.registrar(usuarioId, 'CREAR_PLANTILLA', 'plantillas_correo', p.id);
    return this.obtener(p.id);
  }

  async actualizar(id: string, d: DatosPlantilla, usuarioId: string) {
    const r = await this.ds.query(
      `UPDATE plantillas_correo SET nombre = COALESCE($2, nombre), proposito = COALESCE($3, proposito),
              asunto = COALESCE($4, asunto), cuerpo = COALESCE($5, cuerpo)
        WHERE id = $1 AND activo RETURNING id`,
      [id, d.nombre ?? null, d.proposito ?? null, d.asunto ?? null, d.cuerpo ?? null]);
    if (!filas(r).length) throw new NotFoundException('Plantilla no encontrada.');
    await this.auditoria.registrar(usuarioId, 'EDITAR_PLANTILLA', 'plantillas_correo', id);
    return this.obtener(id);
  }

  /** Se desactiva en vez de borrar: los envíos antiguos siguen apuntando a ella. */
  async eliminar(id: string, usuarioId: string) {
    await this.ds.query(`UPDATE plantillas_correo SET activo = FALSE WHERE id = $1`, [id]);
    await this.auditoria.registrar(usuarioId, 'ELIMINAR_PLANTILLA', 'plantillas_correo', id);
    return { ok: true };
  }

  async agregarAdjunto(id: string, file: Express.Multer.File, usuarioId: string) {
    await this.obtener(id);
    const a = await this.archivos.guardar(file);
    await this.ds.query(`INSERT INTO plantilla_adjuntos (plantilla_id, archivo_id) VALUES ($1, $2)`, [id, a.id]);
    await this.auditoria.registrar(usuarioId, 'ADJUNTO_PLANTILLA', 'plantillas_correo', id, { archivo: a.nombre_original });
    return this.obtener(id);
  }

  async asociarAdjunto(id: string, archivoId: string) {
    await this.obtener(id);
    await this.archivos.obtener(archivoId);
    await this.ds.query(
      `INSERT INTO plantilla_adjuntos (plantilla_id, archivo_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [id, archivoId]);
    return this.obtener(id);
  }

  async quitarAdjunto(id: string, archivoId: string) {
    await this.ds.query(`DELETE FROM plantilla_adjuntos WHERE plantilla_id = $1 AND archivo_id = $2`, [id, archivoId]);
    return this.obtener(id);
  }
}
