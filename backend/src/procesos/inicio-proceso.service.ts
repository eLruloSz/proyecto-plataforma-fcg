import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AuditoriaService } from '../common/auditoria.service';

/**
 * Etapas con que parte un proceso cuando no hay un año anterior del cual
 * copiarlas (según el documento de etapas 2026 del cliente).
 */
const ETAPAS_POR_DEFECTO: { nombre: string; descripcion: string; clave?: string; cupo?: number; requisitos?: string[] }[] = [
  { nombre: 'Invitación a establecimientos', descripcion: 'Presentación a liceos, solicitud de nóminas y definición de invitados' },
  { nombre: 'Presentación de la beca', descripcion: 'Encuentro online con los invitados (3 fechas)', clave: 'ENCUENTRO' },
  {
    nombre: 'Preselección N°1', descripcion: 'Cuestionario, documentos y ranking: 60 a entrevista', cupo: 60,
    requisitos: ['Formulario de postulación', 'Cartola RSH', 'Certificado de notas', 'Declaración de ingresos'],
  },
  { nombre: 'Preselección N°2', descripcion: 'Entrevistas presenciales: 20 finalistas', clave: 'ENTREVISTA', cupo: 20 },
  { nombre: 'Selección de becarios', descripcion: 'Entrevistas con comité y decisión final', clave: 'ENTREVISTA_COMITE', cupo: 10 },
];

const nombreProceso = (anio: number) => `Beca Carmen Goudie ${anio}`;

/**
 * Inicio y cierre del proceso anual.
 *
 *   sin proceso → [Iniciar proceso] → BORRADOR (se revisan los liceos)
 *               → [Confirmar]       → ACTIVO   (el sistema funciona normal)
 *               → [Cerrar proceso]  → CERRADO  (vuelve a aparecer "Iniciar proceso")
 */
@Injectable()
export class InicioProcesoService {
  constructor(private readonly ds: DataSource, private readonly auditoria: AuditoriaService) {}

  /** Lo que necesita la pantalla de inicio para decidir qué mostrar. */
  async estado() {
    const [activo] = await this.ds.query(`SELECT id, nombre, anio FROM procesos WHERE estado = 'ACTIVO' LIMIT 1`);
    const [borrador] = await this.ds.query(`SELECT id, nombre, anio FROM procesos WHERE estado = 'BORRADOR' LIMIT 1`);
    const [ultimo] = await this.ds.query(
      `SELECT id, nombre, anio, estado FROM procesos WHERE estado = 'CERRADO' ORDER BY anio DESC LIMIT 1`);
    const anioSugerido = ultimo ? ultimo.anio + 1 : new Date().getFullYear();

    let detalleBorrador = null;
    if (borrador) {
      const etapas = await this.ds.query(
        `SELECT e.orden, e.nombre, e.cupo,
                (SELECT COUNT(*)::int FROM requisitos_etapa r WHERE r.etapa_id = e.id AND r.activo) AS requisitos
           FROM etapas e WHERE e.proceso_id = $1 ORDER BY e.orden`, [borrador.id]);
      detalleBorrador = { ...borrador, etapas };
    }
    return {
      activo: activo ?? null,
      borrador: detalleBorrador,
      ultimo: ultimo ? { nombre: ultimo.nombre, anio: ultimo.anio } : null,
      anioSugerido,
    };
  }

  /**
   * Crea el proceso del año como BORRADOR: copia las etapas (con cupos y
   * requisitos) del último proceso y deja a todos los liceos activos como
   * participantes, sin revisar.
   */
  async crearBorrador(anio: number, usuarioId: string) {
    const id = await this.ds.transaction(async (em) => {
      const [enCurso] = await em.query(`SELECT nombre, estado FROM procesos WHERE estado IN ('ACTIVO', 'BORRADOR')`);
      if (enCurso?.estado === 'ACTIVO') throw new ConflictException(`Primero hay que cerrar el proceso en curso (${enCurso.nombre}).`);
      if (enCurso) throw new ConflictException('Ya hay un proceso en preparación.');
      await this.verificarAnioLibre(em, anio);

      const [anterior] = await em.query(`SELECT id, sufijo_id FROM procesos ORDER BY anio DESC LIMIT 1`);
      const [p] = await em.query(
        `INSERT INTO procesos (nombre, anio, estado, sufijo_id) VALUES ($1, $2, 'BORRADOR', $3) RETURNING id`,
        [nombreProceso(anio), anio, anterior?.sufijo_id ?? 'a']);

      const copiadas = anterior ? await this.copiarEtapas(em, anterior.id, p.id) : 0;
      if (!copiadas) await this.etapasPorDefecto(em, p.id);

      await em.query(
        `INSERT INTO participaciones_liceo (proceso_id, liceo_id) SELECT $1, id FROM liceos WHERE activo`, [p.id]);
      return p.id as string;
    });
    await this.auditoria.registrar(usuarioId, 'CREAR_PROCESO', 'procesos', id, { anio });
    return this.estado();
  }

  /** Cambia el año del proceso en preparación. */
  async cambiarAnio(anio: number, usuarioId: string) {
    const b = await this.borrador();
    await this.ds.transaction(async (em) => {
      await this.verificarAnioLibre(em, anio, b.id);
      await em.query(`UPDATE procesos SET anio = $2, nombre = $3 WHERE id = $1`, [b.id, anio, nombreProceso(anio)]);
    });
    await this.auditoria.registrar(usuarioId, 'CAMBIAR_ANIO_PROCESO', 'procesos', b.id, { anio });
    return this.estado();
  }

  /** Marca si un liceo participa este año y/o si ya se revisaron sus datos. */
  async marcarLiceo(liceoId: string, datos: { incluido?: boolean; revisado?: boolean }, usuarioId: string) {
    const b = await this.borrador();
    const [l] = await this.ds.query(`SELECT 1 FROM liceos WHERE id = $1`, [liceoId]);
    if (!l) throw new NotFoundException('Liceo no encontrado.');
    const [r] = await this.ds.query(
      `INSERT INTO participaciones_liceo (proceso_id, liceo_id, incluido, revisado_en, revisado_por)
       VALUES ($1, $2, COALESCE($3::boolean, TRUE), CASE WHEN $4::boolean THEN NOW() END, CASE WHEN $4::boolean THEN $5::uuid END)
       ON CONFLICT (proceso_id, liceo_id) DO UPDATE SET
         incluido = COALESCE($3::boolean, participaciones_liceo.incluido),
         revisado_en = CASE WHEN $4::boolean IS NULL THEN participaciones_liceo.revisado_en WHEN $4::boolean THEN NOW() END,
         revisado_por = CASE WHEN $4::boolean IS NULL THEN participaciones_liceo.revisado_por WHEN $4::boolean THEN $5::uuid END
       RETURNING incluido, revisado_en`,
      [b.id, liceoId, datos.incluido ?? null, datos.revisado ?? null, usuarioId]);
    await this.auditoria.registrar(usuarioId, 'REVISAR_LICEO', 'liceos', liceoId, datos);
    return r;
  }

  /** Confirma los liceos y deja el proceso ACTIVO, con su primera etapa en curso. */
  async confirmar(usuarioId: string) {
    const b = await this.borrador();
    await this.ds.transaction(async (em) => {
      const [{ n }] = await em.query(
        `SELECT COUNT(*)::int AS n FROM participaciones_liceo pl JOIN liceos l ON l.id = pl.liceo_id
          WHERE pl.proceso_id = $1 AND pl.incluido AND l.activo`, [b.id]);
      if (!n) throw new BadRequestException('Elige al menos un liceo para iniciar el proceso.');
      await em.query(`UPDATE procesos SET estado = 'ACTIVO' WHERE id = $1`, [b.id]);
      await em.query(
        `UPDATE etapas SET estado = 'ACTIVA', fecha_inicio = CURRENT_DATE
          WHERE proceso_id = $1 AND orden = (SELECT MIN(orden) FROM etapas WHERE proceso_id = $1)`, [b.id]);
    });
    await this.auditoria.registrar(usuarioId, 'INICIAR_PROCESO', 'procesos', b.id);
    return this.estado();
  }

  /**
   * Cierra el proceso activo. Se pide el año como confirmación para no
   * cerrarlo por error. Sus datos quedan guardados como historial.
   */
  async cerrar(anio: number, usuarioId: string) {
    const [p] = await this.ds.query(`SELECT id, anio FROM procesos WHERE estado = 'ACTIVO' LIMIT 1`);
    if (!p) throw new NotFoundException('No hay un proceso activo.');
    if (p.anio !== anio) throw new BadRequestException(`El año no coincide con el del proceso en curso (${p.anio}).`);
    await this.ds.transaction(async (em) => {
      await em.query(
        `UPDATE etapas SET estado = 'CERRADA', fecha_fin = COALESCE(fecha_fin, CURRENT_DATE)
          WHERE proceso_id = $1 AND estado = 'ACTIVA'`, [p.id]);
      await em.query(`UPDATE procesos SET estado = 'CERRADO' WHERE id = $1`, [p.id]);
    });
    await this.auditoria.registrar(usuarioId, 'CERRAR_PROCESO', 'procesos', p.id);
    return this.estado();
  }

  // -------------------------------------------------------------------------

  private async borrador(): Promise<{ id: string; anio: number }> {
    const [b] = await this.ds.query(`SELECT id, anio FROM procesos WHERE estado = 'BORRADOR' LIMIT 1`);
    if (!b) throw new NotFoundException('No hay un proceso en preparación.');
    return b;
  }

  private async verificarAnioLibre(em: EntityManager, anio: number, exceptoId?: string) {
    const [otro] = await em.query(
      `SELECT 1 FROM procesos WHERE anio = $1 AND ($2::uuid IS NULL OR id <> $2)`, [anio, exceptoId ?? null]);
    if (otro) throw new ConflictException(`Ya existe un proceso del año ${anio}.`);
  }

  /** Copia etapas (nombre, descripción, clave, cupo) y sus requisitos activos. Devuelve cuántas copió. */
  private async copiarEtapas(em: EntityManager, desdeId: string, haciaId: string): Promise<number> {
    const etapas = await em.query(
      `SELECT id, orden, nombre, descripcion, clave, cupo FROM etapas WHERE proceso_id = $1 ORDER BY orden`, [desdeId]);
    for (const e of etapas) {
      const [nueva] = await em.query(
        `INSERT INTO etapas (proceso_id, orden, nombre, descripcion, clave, cupo) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [haciaId, e.orden, e.nombre, e.descripcion, e.clave, e.cupo]);
      await em.query(
        `INSERT INTO requisitos_etapa (etapa_id, nombre, orden)
         SELECT $1, nombre, orden FROM requisitos_etapa WHERE etapa_id = $2 AND activo ORDER BY orden`,
        [nueva.id, e.id]);
    }
    return etapas.length;
  }

  private async etapasPorDefecto(em: EntityManager, procesoId: string) {
    for (const [i, e] of ETAPAS_POR_DEFECTO.entries()) {
      const [nueva] = await em.query(
        `INSERT INTO etapas (proceso_id, orden, nombre, descripcion, clave, cupo) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [procesoId, i + 1, e.nombre, e.descripcion, e.clave ?? null, e.cupo ?? null]);
      for (const [j, r] of (e.requisitos ?? []).entries()) {
        await em.query(`INSERT INTO requisitos_etapa (etapa_id, nombre, orden) VALUES ($1, $2, $3)`, [nueva.id, r, j + 1]);
      }
    }
  }
}