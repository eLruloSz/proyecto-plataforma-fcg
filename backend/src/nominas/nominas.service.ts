import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { leerNomina, normalizar, ResultadoLectura } from './parser';
import { ProcesoActualService } from '../common/proceso-actual.service';
import { AuditoriaService } from '../common/auditoria.service';
import { HitosService } from '../hitos/hitos.service';

@Injectable()
export class NominasService {
  constructor(
    private readonly ds: DataSource,
    private readonly proceso: ProcesoActualService,
    private readonly auditoria: AuditoriaService,
    private readonly hitos: HitosService,
  ) {}

  private async liceo(id: string) {
    const [l] = await this.ds.query(`SELECT id, codigo, nombre FROM liceos WHERE id = $1`, [id]);
    if (!l) throw new NotFoundException('Liceo no encontrado.');
    return l;
  }

  private async leer(liceoId: string, file: Express.Multer.File) {
    if (!file) throw new BadRequestException('Adjunta el Excel de la nómina.');
    if (!/\.xlsx$/i.test(file.originalname)) {
      throw new BadRequestException('El archivo debe ser .xlsx (si es .xls, ábrelo y guárdalo como .xlsx).');
    }
    const liceo = await this.liceo(liceoId);
    const lectura = await leerNomina(file.buffer);
    const avisosExtra: { mensaje: string }[] = [];

    // ¿El archivo es de otro liceo? (compara palabras del nombre)
    if (lectura.liceoEnArchivo && !this.mismoLiceo(liceo.nombre, lectura.liceoEnArchivo)) {
      avisosExtra.push({
        mensaje: `El archivo dice "${lectura.liceoEnArchivo}", pero lo estás subiendo a ${liceo.nombre}. Revisa que sea el archivo correcto.`,
      });
    }
    const procesoId = await this.proceso.id();
    const [previa] = await this.ds.query(
      `SELECT ca.nombre_archivo, ca.cargado_en,
              (SELECT COUNT(*)::int FROM postulaciones p WHERE p.liceo_id = $1 AND p.proceso_id = $2) AS invitados
         FROM cargas ca WHERE ca.liceo_id = $1 AND ca.proceso_id = $2 AND ca.tipo = 'NOMINA_NOTAS'`,
      [liceoId, procesoId],
    );
    if (previa) {
      avisosExtra.push({
        mensaje: `Este liceo ya tiene una nómina cargada (${previa.nombre_archivo}). Al confirmar se reemplaza.` +
          (previa.invitados ? ` Sus ${previa.invitados} invitados se mantienen con su Id.` : ''),
      });
    }
    lectura.advertencias.unshift(...avisosExtra);
    return { liceo, procesoId, lectura };
  }

  private mismoLiceo(a: string, b: string): boolean {
    const ignorar = new Set(['liceo', 'colegio', 'de', 'del', 'la', 'el', 'los', 'y', 'escuela', 'instituto', 'bicentenario', 'excelencia']);
    const palabras = (s: string) => new Set(normalizar(s).split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !ignorar.has(w)));
    const pa = palabras(a);
    const pb = palabras(b);
    if (!pa.size || !pb.size) return true;
    return [...pa].some((w) => pb.has(w));
  }

  /** Lee el archivo y devuelve lo que se cargaría, sin guardar nada. */
  async previsualizar(liceoId: string, file: Express.Multer.File) {
    const { liceo, lectura } = await this.leer(liceoId, file);
    return { liceo, ...this.resumen(lectura) };
  }

  private resumen(l: ResultadoLectura) {
    return {
      liceoEnArchivo: l.liceoEnArchivo,
      cursos: l.cursos,
      totalAlumnos: l.alumnos.length,
      alumnos: l.alumnos,
      errores: l.errores,
      advertencias: l.advertencias,
    };
  }

  /**
   * Guarda la nómina (reemplaza la anterior del liceo). Además:
   *  - marca el hito "Recepción de nómina"
   *  - marca como respondido el último correo de solicitud de notas a ese liceo
   *  - si el liceo no había confirmado participación, lo deja como PARTICIPA
   *  - vuelve a enlazar a los invitados existentes con su fila de la nueva nómina
   */
  async confirmar(liceoId: string, file: Express.Multer.File, usuarioId: string) {
    const { liceo, procesoId, lectura } = await this.leer(liceoId, file);
    if (!lectura.alumnos.length) {
      throw new BadRequestException({
        message: 'El archivo no tiene alumnos válidos para cargar.',
        errores: lectura.errores,
      });
    }

    const cargaId = await this.ds.transaction(async (em) => {
      await em.query(
        `DELETE FROM cargas WHERE liceo_id = $1 AND proceso_id = $2 AND tipo = 'NOMINA_NOTAS'`,
        [liceoId, procesoId],
      );
      const [carga] = await em.query(
        `INSERT INTO cargas (proceso_id, liceo_id, tipo, nombre_archivo, filas_ok, advertencias, cargado_por)
         VALUES ($1, $2, 'NOMINA_NOTAS', $3, $4, $5, $6) RETURNING id`,
        [procesoId, liceoId, file.originalname.slice(0, 255), lectura.alumnos.length,
          JSON.stringify([...lectura.errores, ...lectura.advertencias]), usuarioId],
      );
      await this.insertarAlumnos(em, procesoId, liceoId, carga.id, lectura);
      await this.reenlazarInvitados(em, procesoId, liceoId);

      await this.hitos.marcarAutomatico(procesoId, liceoId, 'RECEPCION_NOMINA', em);
      await em.query(
        `UPDATE envio_destinatarios SET respuesta = 'RESPONDIDO', respuesta_auto = TRUE, respondido_en = NOW(),
                respuesta_nota = 'Nómina cargada en el sistema'
          WHERE id = (SELECT d.id FROM envio_destinatarios d JOIN envios e ON e.id = d.envio_id
                       WHERE d.liceo_id = $1 AND e.proceso_id = $2 AND e.proposito = 'SOLICITUD_NOTAS'
                         AND d.respuesta = 'PENDIENTE'
                       ORDER BY e.enviado_en DESC LIMIT 1)`,
        [liceoId, procesoId],
      );
      await em.query(
        `INSERT INTO participaciones_liceo (proceso_id, liceo_id, estado) VALUES ($1, $2, 'PARTICIPA')
         ON CONFLICT (proceso_id, liceo_id) DO UPDATE SET estado = 'PARTICIPA'
         WHERE participaciones_liceo.estado = 'PENDIENTE'`,
        [procesoId, liceoId],
      );
      await this.auditoria.registrar(usuarioId, 'CARGAR_NOMINA', 'liceos', liceoId,
        { archivo: file.originalname, alumnos: lectura.alumnos.length }, em);
      return carga.id as string;
    });

    return { cargaId, liceo, ...this.resumen(lectura), alumnos: undefined };
  }

  private async insertarAlumnos(em: EntityManager, procesoId: string, liceoId: string, cargaId: string, l: ResultadoLectura) {
    const COLS = 14;
    const LOTE = 400;
    for (let i = 0; i < l.alumnos.length; i += LOTE) {
      const lote = l.alumnos.slice(i, i + LOTE);
      const valores: unknown[] = [];
      const marcas = lote.map((a, j) => {
        valores.push(procesoId, liceoId, cargaId, a.curso, a.cursoOriginal.slice(0, 100), a.especialidad?.slice(0, 200) ?? null,
          a.nLista, a.apellidoPaterno.slice(0, 100), a.apellidoMaterno?.slice(0, 100) ?? null, a.nombres.slice(0, 150),
          a.promedio1m, a.promedio2m, a.promedio, a.posicionCurso);
        const b = j * COLS;
        return `(${Array.from({ length: COLS }, (_, k) => `$${b + k + 1}`).join(',')})`;
      });
      await em.query(
        `INSERT INTO alumnos_nomina (proceso_id, liceo_id, carga_id, curso, curso_original, especialidad, n_lista,
           apellido_paterno, apellido_materno, nombres, promedio_1m, promedio_2m, promedio, posicion_curso)
         VALUES ${marcas.join(',')}`,
        valores,
      );
    }
  }

  /** Tras reemplazar una nómina, une a cada invitado con su fila nueva (mismo curso y nombre). */
  private async reenlazarInvitados(em: EntityManager, procesoId: string, liceoId: string) {
    await em.query(
      `UPDATE postulaciones p SET alumno_nomina_id = a.id, promedio = a.promedio, posicion_curso = a.posicion_curso
         FROM personas pe, alumnos_nomina a
        WHERE p.persona_id = pe.id AND p.proceso_id = $1 AND p.liceo_id = $2 AND p.alumno_nomina_id IS NULL
          AND a.proceso_id = $1 AND a.liceo_id = $2 AND a.curso = p.curso
          AND lower(a.nombres) = lower(pe.nombres) AND lower(a.apellido_paterno) = lower(pe.apellido_paterno)
          AND lower(COALESCE(a.apellido_materno, '')) = lower(COALESCE(pe.apellido_materno, ''))
          AND NOT EXISTS (SELECT 1 FROM postulaciones p2 WHERE p2.alumno_nomina_id = a.id)`,
      [procesoId, liceoId],
    );
  }

  /**
   * Nómina de un liceo agrupada por curso, con la sugerencia de invitados:
   * los que están en las primeras `porCurso` posiciones de su curso
   * (si hay empate en el límite, entran todos los empatados).
   */
  async obtener(liceoId: string, porCurso: number) {
    const liceo = await this.liceo(liceoId);
    const procesoId = await this.proceso.id();
    const [carga] = await this.ds.query(
      `SELECT id, nombre_archivo, cargado_en, advertencias FROM cargas
        WHERE liceo_id = $1 AND proceso_id = $2 AND tipo = 'NOMINA_NOTAS'`,
      [liceoId, procesoId],
    );
    if (!carga) return { liceo, carga: null, cursos: [] };

    const alumnos = await this.ds.query(
      `SELECT a.id, a.curso, a.especialidad, a.n_lista, a.apellido_paterno, a.apellido_materno, a.nombres,
              a.promedio_1m::float, a.promedio_2m::float, a.promedio::float, a.posicion_curso,
              p.id AS postulacion_id, p.codigo
         FROM alumnos_nomina a
         LEFT JOIN postulaciones p ON p.alumno_nomina_id = a.id
        WHERE a.carga_id = $1
        ORDER BY a.curso, a.posicion_curso, a.apellido_paterno`,
      [carga.id],
    );
    const cursos = new Map<string, { curso: string; especialidad: string | null; alumnos: unknown[] }>();
    for (const a of alumnos) {
      if (!cursos.has(a.curso)) cursos.set(a.curso, { curso: a.curso, especialidad: a.especialidad, alumnos: [] });
      cursos.get(a.curso)!.alumnos.push({ ...a, sugerido: a.posicion_curso <= porCurso });
    }
    return { liceo, carga, cursos: [...cursos.values()] };
  }

  async eliminar(liceoId: string, usuarioId: string) {
    const procesoId = await this.proceso.id();
    await this.ds.query(
      `DELETE FROM cargas WHERE liceo_id = $1 AND proceso_id = $2 AND tipo = 'NOMINA_NOTAS'`,
      [liceoId, procesoId],
    );
    await this.auditoria.registrar(usuarioId, 'ELIMINAR_NOMINA', 'liceos', liceoId);
    return { ok: true };
  }
}
