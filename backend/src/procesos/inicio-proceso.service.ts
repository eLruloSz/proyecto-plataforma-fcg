import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AuditoriaService } from '../common/auditoria.service';
import { ResumenGeneracionService } from '../generaciones/resumen.service';

/**
 * Etapas con que parte un proceso cuando no hay un año anterior del cual
 * copiarlas (según el documento de etapas 2026 del cliente).
 */
const ETAPAS_POR_DEFECTO: { nombre: string; descripcion: string; clave?: string; cupo?: number; requisitos?: string[] }[] = [
  { nombre: 'Invitación a establecimientos', descripcion: 'Presentación a liceos, solicitud de nóminas y definición de invitados' },
  { nombre: 'Presentación de la beca', descripcion: 'Encuentro online con los invitados (3 fechas)', clave: 'ENCUENTRO' },
  {
    nombre: 'Preselección N°1', descripcion: 'Cuestionario, documentos y ranking: 60 a entrevista', clave: 'PRESELECCION', cupo: 60,
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
 *
 * Al cerrar se guarda el resumen del año para el histórico de generaciones.
 * Un proceso cerrado no se reabre. Las generaciones históricas ingresadas a
 * mano (historico = TRUE) no cuentan como "proceso anterior" para copiar.
 */
@Injectable()
export class InicioProcesoService {
  constructor(
    private readonly ds: DataSource,
    private readonly auditoria: AuditoriaService,
    private readonly resumenes: ResumenGeneracionService,
  ) {}

  /** Lo que necesita la pantalla de inicio para decidir qué mostrar. */
  async estado() {
    const [activo] = await this.ds.query(`SELECT id, nombre, anio FROM procesos WHERE estado = 'ACTIVO' LIMIT 1`);
    const [borrador] = await this.ds.query(`SELECT id, nombre, anio FROM procesos WHERE estado = 'BORRADOR' LIMIT 1`);
    const [ultimo] = await this.ds.query(
      `SELECT id, nombre, anio, estado FROM procesos WHERE estado = 'CERRADO' AND NOT historico ORDER BY anio DESC LIMIT 1`);
    // El año siguiente al último proceso (o el actual), saltándose los años que
    // ya tienen una generación (también las ingresadas a mano).
    const [{ max }] = await this.ds.query(`SELECT MAX(anio) AS max FROM procesos`);
    const anioSugerido = Math.max(ultimo ? ultimo.anio + 1 : new Date().getFullYear(), (max ?? 0) + 1);

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
   * Crea el proceso del año como BORRADOR, con los liceos sin revisar.
   *
   * usarBase = TRUE (por defecto): copia del último proceso las etapas (con
   * cupos y requisitos) y deja marcados los mismos liceos que participaron ese
   * año (más los liceos agregados después). Las plantillas de correo y los
   * contactos de los liceos no dependen del año: siempre se mantienen.
   *
   * usarBase = FALSE: etapas por defecto y todos los liceos activos marcados.
   */
  async crearBorrador(anio: number, usuarioId: string, usarBase = true) {
    const id = await this.ds.transaction(async (em) => {
      const [enCurso] = await em.query(`SELECT nombre, estado FROM procesos WHERE estado IN ('ACTIVO', 'BORRADOR')`);
      if (enCurso?.estado === 'ACTIVO') throw new ConflictException(`Primero hay que cerrar el proceso en curso (${enCurso.nombre}).`);
      if (enCurso) throw new ConflictException('Ya hay un proceso en preparación.');
      await this.verificarAnioLibre(em, anio);

      const [anterior] = await em.query(
        `SELECT id, anio, sufijo_id FROM procesos WHERE NOT historico ORDER BY anio DESC LIMIT 1`);
      const base = usarBase ? anterior : undefined;
      const [p] = await em.query(
        `INSERT INTO procesos (nombre, anio, estado, sufijo_id) VALUES ($1, $2, 'BORRADOR', $3) RETURNING id`,
        [nombreProceso(anio), anio, anterior?.sufijo_id ?? 'a']);

      const copiadas = base ? await this.copiarEtapas(em, base.id, p.id) : 0;
      if (!copiadas) await this.etapasPorDefecto(em, p.id);

      // Con base: participa si participó en el proceso base, o si el liceo no
      // estaba en ese proceso (se agregó después).
      await em.query(
        `INSERT INTO participaciones_liceo (proceso_id, liceo_id, incluido)
         SELECT $1, l.id, COALESCE(ant.incluido, TRUE)
           FROM liceos l
           LEFT JOIN participaciones_liceo ant ON ant.liceo_id = l.id AND ant.proceso_id = $2
          WHERE l.activo`,
        [p.id, base?.id ?? null]);
      return p.id as string;
    });
    await this.auditoria.registrar(usuarioId, 'CREAR_PROCESO', 'procesos', id, { anio, usarBase });
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

  /**
   * Descarta el proceso en preparación y vuelve a la pantalla "Iniciar
   * proceso". Se borran solo las marcas de ese año (participa / revisado) y
   * sus etapas copiadas; los cambios a liceos y contactos se mantienen,
   * porque esos datos no dependen del año.
   */
  async descartarBorrador(usuarioId: string) {
    const b = await this.borrador();
    await this.ds.query(`DELETE FROM procesos WHERE id = $1 AND estado = 'BORRADOR'`, [b.id]);
    await this.auditoria.registrar(usuarioId, 'DESCARTAR_PROCESO', 'procesos', b.id, { anio: b.anio });
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
   * cerrarlo por error. Sus datos quedan guardados y se guarda el resumen
   * para el histórico de generaciones. No se puede reabrir.
   */
  async cerrar(anio: number, usuarioId: string) {
    const [p] = await this.ds.query(`SELECT id, anio FROM procesos WHERE estado = 'ACTIVO' LIMIT 1`);
    if (!p) throw new NotFoundException('No hay un proceso activo.');
    if (p.anio !== anio) throw new BadRequestException(`El año no coincide con el del proceso en curso (${p.anio}).`);
    await this.ds.transaction(async (em) => {
      await em.query(
        `UPDATE etapas SET estado = 'CERRADA', fecha_fin = COALESCE(fecha_fin, CURRENT_DATE)
          WHERE proceso_id = $1 AND estado = 'ACTIVA'`, [p.id]);
      await em.query(`UPDATE procesos SET estado = 'CERRADO', cerrado_en = NOW() WHERE id = $1`, [p.id]);
      await this.resumenes.guardar(p.id, em);
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
    if (otro) throw new ConflictException(`Ya existe un proceso o una generación del año ${anio}.`);
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