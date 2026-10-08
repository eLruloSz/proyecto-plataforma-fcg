import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ProcesoActualService } from '../common/proceso-actual.service';
import { AuditoriaService } from '../common/auditoria.service';
import { ArchivosService } from '../common/archivos.service';
import { HitosService, HITO_POR_PROPOSITO, HITO_RESPUESTA_POR_PROPOSITO } from '../hitos/hitos.service';
import { MailerService, limpiarMessageId } from './mailer.service';
import { asuntoVisible, reemplazarVariables, variablesDesconocidas } from './variables';
import { filas } from '../common/sql';

export type Grupo = 'CONTRAPARTES' | 'DIRECTORES' | 'LICEO' | 'POSTULANTES';

export interface SolicitudEnvio {
  grupo: Grupo;
  proposito?: string;
  asunto: string;
  cuerpo: string;
  plantillaId?: string;
  adjuntoIds?: string[];
  /** LICEO: liceos elegidos. CONTRAPARTES/DIRECTORES: restringe a estos liceos (opcional). */
  liceoIds?: string[];
  /** POSTULANTES: estudiantes elegidos (si no viene, todos los invitados con email). */
  postulacionIds?: string[];
  /** Reenviar solo a quienes no respondieron un envío anterior. */
  envioOrigenId?: string;
  /** Destinatarios que el usuario quitó de la lista antes de enviar (ids de liceo o postulación). */
  excluir?: string[];
}

interface Destinatario {
  clave: string; // liceo_id o postulacion_id: identifica la fila en la lista
  liceoId: string | null;
  postulacionId: string | null;
  nombre: string;
  cargo: string | null;
  email: string;
  liceo: string;
  codigo?: string;
  curso?: string;
}

interface Excluido {
  clave: string;
  nombre: string;
  liceo: string;
  motivo: string;
}

@Injectable()
export class EnviosService {
  private readonly log = new Logger('Envios');

  constructor(
    private readonly ds: DataSource,
    private readonly proceso: ProcesoActualService,
    private readonly auditoria: AuditoriaService,
    private readonly archivos: ArchivosService,
    private readonly hitos: HitosService,
    private readonly mailer: MailerService,
  ) {}

  // -------------------------------------------------------------------------
  // Destinatarios
  // -------------------------------------------------------------------------

  private async resolver(s: SolicitudEnvio, procesoId: string) {
    let grupo = s.grupo;
    let liceoIds = s.liceoIds;
    let postulacionIds = s.postulacionIds;

    // "Reenviar a los que faltan": se toman los pendientes del envío original y se
    // vuelven a resolver con los datos de contacto ACTUALES (si se corrigió un
    // correo que rebotó, el reenvío usa el correo nuevo).
    if (s.envioOrigenId) {
      const [origen] = await this.ds.query(
        `SELECT grupo FROM envios WHERE id = $1 AND proceso_id = $2`, [s.envioOrigenId, procesoId]);
      if (!origen) throw new NotFoundException('Envío original no encontrado.');
      grupo = origen.grupo;
      const pendientes = await this.ds.query(
        `SELECT liceo_id, postulacion_id FROM envio_destinatarios WHERE envio_id = $1 AND respuesta = 'PENDIENTE'`,
        [s.envioOrigenId]);
      if (grupo === 'POSTULANTES') postulacionIds = pendientes.map((d: any) => d.postulacion_id).filter(Boolean);
      else liceoIds = pendientes.map((d: any) => d.liceo_id).filter(Boolean);
      if (!pendientes.length) return { grupo, destinatarios: [] as Destinatario[], excluidos: [] as Excluido[] };
    }

    const destinatarios: Destinatario[] = [];
    const excluidos: Excluido[] = [];
    const quitar = new Set(s.excluir ?? []);

    if (grupo === 'POSTULANTES') {
      const filasP = await this.ds.query(
        `SELECT p.id, p.codigo, p.curso, p.estado, l.id AS liceo_id, l.nombre AS liceo,
                pe.nombres, pe.apellido_paterno, pe.email
           FROM postulaciones p JOIN personas pe ON pe.id = p.persona_id JOIN liceos l ON l.id = p.liceo_id
          WHERE p.proceso_id = $1 ${postulacionIds ? 'AND p.id = ANY($2::uuid[])' : ''}
          ORDER BY p.correlativo`,
        postulacionIds ? [procesoId, postulacionIds] : [procesoId],
      );
      for (const r of filasP) {
        const nombre = `${r.nombres} ${r.apellido_paterno}`;
        const base = { clave: r.id, nombre, liceo: r.liceo };
        if (r.estado === 'DESISTIO') excluidos.push({ ...base, motivo: 'Rechazó la invitación' });
        else if (!r.email) excluidos.push({ ...base, motivo: 'Sin email registrado' });
        else if (quitar.has(r.id)) excluidos.push({ ...base, motivo: 'Quitado de la lista' });
        else destinatarios.push({ ...base, liceoId: r.liceo_id, postulacionId: r.id, cargo: null, email: r.email, codigo: r.codigo, curso: r.curso });
      }
      return { grupo, destinatarios, excluidos };
    }

    if (grupo === 'LICEO' && !liceoIds?.length) throw new BadRequestException('Elige al menos un liceo.');
    const tipo = grupo === 'DIRECTORES' ? 'DIRECTOR' : 'CONTRAPARTE';
    const filasL = await this.ds.query(
      `SELECT l.id, l.nombre AS liceo, c.nombre, c.cargo, c.email, COALESCE(pl.estado, 'PENDIENTE') AS participacion
         FROM liceos l
         LEFT JOIN contactos_liceo c ON c.liceo_id = l.id AND c.tipo = $2
         LEFT JOIN participaciones_liceo pl ON pl.liceo_id = l.id AND pl.proceso_id = $1
        WHERE l.activo ${liceoIds ? 'AND l.id = ANY($3::uuid[])' : ''}
        ORDER BY l.codigo`,
      liceoIds ? [procesoId, tipo, liceoIds] : [procesoId, tipo],
    );
    const etiqueta = tipo === 'DIRECTOR' ? 'director/a' : 'contraparte';
    for (const r of filasL) {
      const base = { clave: r.id, nombre: r.nombre ?? `(sin ${etiqueta})`, liceo: r.liceo };
      // Un liceo que dijo que no participa no recibe envíos grupales; a uno
      // puntual sí se le puede escribir (por ejemplo, para cerrar el contacto).
      if (r.participacion === 'NO_PARTICIPA' && grupo !== 'LICEO') excluidos.push({ ...base, motivo: 'No participa en el proceso' });
      else if (!r.nombre) excluidos.push({ ...base, motivo: `No tiene ${etiqueta} registrada` });
      else if (!r.email) excluidos.push({ ...base, motivo: `La ${etiqueta} no tiene email` });
      else if (quitar.has(r.id)) excluidos.push({ ...base, motivo: 'Quitado de la lista' });
      else destinatarios.push({ ...base, liceoId: r.id, postulacionId: null, cargo: r.cargo, email: r.email });
    }
    return { grupo, destinatarios, excluidos };
  }

  private async valoresComunes(usuarioId: string) {
    const p = await this.proceso.obtener();
    const [u] = await this.ds.query(`SELECT email, nombre_completo, firma FROM usuarios WHERE id = $1`, [usuarioId]);
    return { proceso: p, usuario: u, comunes: { anio: String(p.anio), firma: u?.firma ?? u?.nombre_completo ?? '' } };
  }

  private renderizar(d: Destinatario, s: SolicitudEnvio, comunes: Record<string, string>) {
    const vars = { ...comunes, nombre: d.nombre, cargo: d.cargo ?? '', liceo: d.liceo, codigo: d.codigo ?? '', curso: d.curso ?? '' };
    return { asunto: reemplazarVariables(s.asunto, vars), cuerpo: reemplazarVariables(s.cuerpo, vars) };
  }

  /** Muestra exactamente a quién le llegaría y cómo se vería, sin enviar nada. */
  async previsualizar(s: SolicitudEnvio, usuarioId: string) {
    const { proceso, comunes } = await this.valoresComunes(usuarioId);
    const { grupo, destinatarios, excluidos } = await this.resolver(s, proceso.id);
    const advertencias: string[] = [];
    const desconocidas = variablesDesconocidas(`${s.asunto} ${s.cuerpo}`);
    if (desconocidas.length) {
      advertencias.push(`Estas variables no existen y se enviarán tal cual: ${desconocidas.map((v) => `{{${v}}}`).join(', ')}.`);
    }
    if (grupo !== 'POSTULANTES' && /\{\{\s*(codigo|curso)\s*\}\}/i.test(s.cuerpo + s.asunto)) {
      advertencias.push('{{codigo}} y {{curso}} solo tienen valor en correos a estudiantes.');
    }
    return {
      grupo,
      destinatarios: destinatarios.map((d) => ({ ...d, ...this.renderizar(d, s, comunes) })),
      excluidos,
      advertencias,
    };
  }

  // -------------------------------------------------------------------------
  // Envío
  // -------------------------------------------------------------------------

  async enviar(s: SolicitudEnvio, usuarioId: string) {
    const { proceso, usuario, comunes } = await this.valoresComunes(usuarioId);
    const { grupo, destinatarios } = await this.resolver(s, proceso.id);
    if (!destinatarios.length) throw new BadRequestException('No hay destinatarios con email para este envío.');

    const adjuntoIds = [...new Set(s.adjuntoIds ?? [])];
    for (const id of adjuntoIds) await this.archivos.obtener(id); // valida que existan

    let proposito = s.proposito ?? 'OTRO';
    if (s.plantillaId && !s.proposito) {
      const [pl] = await this.ds.query(`SELECT proposito FROM plantillas_correo WHERE id = $1`, [s.plantillaId]);
      proposito = pl?.proposito ?? 'OTRO';
    }
    if (s.envioOrigenId && !s.proposito) {
      const [o] = await this.ds.query(`SELECT proposito FROM envios WHERE id = $1`, [s.envioOrigenId]);
      proposito = o?.proposito ?? proposito;
    }

    const envioId = await this.ds.transaction(async (em) => {
      const [envio] = await em.query(
        `INSERT INTO envios (proceso_id, plantilla_id, envio_origen_id, proposito, grupo, asunto, cuerpo, total, enviado_por)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [proceso.id, s.plantillaId ?? null, s.envioOrigenId ?? null, proposito, grupo, s.asunto, s.cuerpo,
          destinatarios.length, usuarioId],
      );
      for (const id of adjuntoIds) {
        await em.query(`INSERT INTO envio_adjuntos (envio_id, archivo_id) VALUES ($1, $2)`, [envio.id, id]);
      }
      for (const d of destinatarios) {
        const r = this.renderizar(d, s, comunes);
        await em.query(
          `INSERT INTO envio_destinatarios (envio_id, liceo_id, postulacion_id, nombre, email, asunto_final, cuerpo_final)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [envio.id, d.liceoId, d.postulacionId, d.nombre, d.email, r.asunto.slice(0, 300), r.cuerpo],
        );
      }
      await this.auditoria.registrar(usuarioId, 'ENVIAR_CORREO', 'envios', envio.id,
        { grupo, proposito, total: destinatarios.length }, em);
      return envio.id as string;
    });

    // El envío real ocurre en segundo plano: la pantalla muestra el avance
    // consultando el detalle del envío.
    void this.procesarEnvio(envioId, proceso.id, proposito, grupo, usuario?.email);
    return this.detalle(envioId);
  }

  private async procesarEnvio(envioId: string, procesoId: string, proposito: string, grupo: string, responderA?: string) {
    try {
      const adjuntos = [];
      for (const a of await this.ds.query(
        `SELECT ar.* FROM envio_adjuntos ea JOIN archivos ar ON ar.id = ea.archivo_id WHERE ea.envio_id = $1`, [envioId])) {
        adjuntos.push({ nombre: a.nombre_original, contenido: await this.archivos.leer(a), tipo: a.mime_type });
      }
      const pendientes = await this.ds.query(
        `SELECT id, liceo_id, email, asunto_final, cuerpo_final FROM envio_destinatarios
          WHERE envio_id = $1 AND entrega = 'PENDIENTE'`, [envioId]);
      const hito = grupo !== 'POSTULANTES' ? HITO_POR_PROPOSITO[proposito] : undefined;

      for (const d of pendientes) {
        try {
          const { idExterno } = await this.mailer.enviar({
            para: d.email, asunto: d.asunto_final, texto: d.cuerpo_final, responderA, adjuntos,
          });
          await this.ds.query(
            `UPDATE envio_destinatarios SET entrega = 'ENVIADO', id_externo = $2, error = NULL WHERE id = $1`,
            [d.id, idExterno]);
          if (hito && d.liceo_id) await this.hitos.marcarAutomatico(procesoId, d.liceo_id, hito);
        } catch (e) {
          await this.ds.query(
            `UPDATE envio_destinatarios SET entrega = 'FALLIDO', error = $2 WHERE id = $1`,
            [d.id, (e as Error).message.slice(0, 1000)]);
        }
        await new Promise((r) => setTimeout(r, 150)); // no saturar el servidor SMTP
      }
    } catch (e) {
      this.log.error(`Error procesando el envío ${envioId}: ${(e as Error).message}`);
    }
  }

  // -------------------------------------------------------------------------
  // Consulta y seguimiento
  // -------------------------------------------------------------------------

  async listar() {
    const proceso = await this.proceso.obtener();
    const procesoId = proceso.id;
    const lista = await this.ds.query(
      `SELECT e.id, e.grupo, e.proposito, e.asunto, e.total, e.enviado_en, e.envio_origen_id,
              u.nombre_completo AS enviado_por,
              COUNT(*) FILTER (WHERE d.entrega IN ('ENVIADO','ENTREGADO'))::int AS enviados,
              COUNT(*) FILTER (WHERE d.entrega IN ('REBOTADO','FALLIDO'))::int AS con_problema,
              COUNT(*) FILTER (WHERE d.entrega = 'PENDIENTE')::int AS en_cola,
              COUNT(*) FILTER (WHERE d.respuesta = 'RESPONDIDO')::int AS respondidos,
              COUNT(*) FILTER (WHERE d.respuesta = 'PENDIENTE')::int AS sin_respuesta,
              (SELECT COUNT(*)::int FROM envio_adjuntos ea WHERE ea.envio_id = e.id) AS adjuntos
         FROM envios e
         JOIN envio_destinatarios d ON d.envio_id = e.id
         LEFT JOIN usuarios u ON u.id = e.enviado_por
        WHERE e.proceso_id = $1
        GROUP BY e.id, u.nombre_completo
        ORDER BY e.enviado_en DESC`,
      [procesoId],
    );
    return lista.map((e: any) => ({ ...e, asunto: asuntoVisible(e.asunto, proceso.anio) }));
  }

  async detalle(id: string) {
    const proceso = await this.proceso.obtener();
    const procesoId = proceso.id;
    const [e] = await this.ds.query(
      `SELECT e.*, u.nombre_completo AS enviado_por_nombre FROM envios e
         LEFT JOIN usuarios u ON u.id = e.enviado_por WHERE e.id = $1 AND e.proceso_id = $2`, [id, procesoId]);
    if (!e) throw new NotFoundException('Envío no encontrado.');
    const destinatarios = await this.ds.query(
      `SELECT d.id, d.liceo_id, d.postulacion_id, d.nombre, d.email, d.entrega, d.error, d.respuesta,
              d.respuesta_nota, d.respuesta_auto, d.respondido_en, d.asunto_final, d.cuerpo_final,
              l.nombre AS liceo, p.codigo, COALESCE(pl.estado, 'PENDIENTE') AS participacion,
              ur.nombre_completo AS respondido_por
         FROM envio_destinatarios d
         LEFT JOIN liceos l ON l.id = d.liceo_id
         LEFT JOIN postulaciones p ON p.id = d.postulacion_id
         LEFT JOIN participaciones_liceo pl ON pl.liceo_id = d.liceo_id AND pl.proceso_id = $2
         LEFT JOIN usuarios ur ON ur.id = d.respondido_por
        WHERE d.envio_id = $1
        ORDER BY d.respuesta ASC, l.nombre, d.nombre`, // primero los que faltan
      [id, procesoId]);
    const adjuntos = await this.ds.query(
      `SELECT ar.id, ar.nombre_original, ar.tamano_bytes FROM envio_adjuntos ea
         JOIN archivos ar ON ar.id = ea.archivo_id WHERE ea.envio_id = $1`, [id]);
    return { ...e, asunto_visible: asuntoVisible(e.asunto, proceso.anio), destinatarios, adjuntos };
  }

  /**
   * Marca (o desmarca) que un destinatario respondió. En el correo de
   * presentación se puede indicar además si el liceo participa o no.
   */
  async marcarRespuesta(
    envioId: string,
    destinatarioId: string,
    datos: { respondido: boolean; nota?: string; participa?: boolean },
    usuarioId: string,
  ) {
    const procesoId = await this.proceso.id();
    const [d] = await this.ds.query(
      `SELECT d.id, d.liceo_id, e.proposito, e.grupo FROM envio_destinatarios d JOIN envios e ON e.id = d.envio_id
        WHERE d.id = $1 AND d.envio_id = $2 AND e.proceso_id = $3`, [destinatarioId, envioId, procesoId]);
    if (!d) throw new NotFoundException('Destinatario no encontrado.');

    await this.ds.transaction(async (em) => {
      await em.query(
        `UPDATE envio_destinatarios SET
           respuesta = $2::varchar, respuesta_auto = FALSE,
           respondido_en = CASE WHEN $2::varchar = 'RESPONDIDO' THEN NOW() END,
           respondido_por = CASE WHEN $2::varchar = 'RESPONDIDO' THEN $3::uuid END,
           respuesta_nota = COALESCE($4, respuesta_nota)
         WHERE id = $1`,
        [d.id, datos.respondido ? 'RESPONDIDO' : 'PENDIENTE', usuarioId, datos.nota ?? null]);

      if (d.liceo_id && d.grupo !== 'POSTULANTES') {
        const hito = HITO_RESPUESTA_POR_PROPOSITO[d.proposito];
        if (hito && datos.respondido) await this.hitos.marcarAutomatico(procesoId, d.liceo_id, hito, em);
        if (d.proposito === 'PRESENTACION' && datos.participa !== undefined) {
          await em.query(
            `INSERT INTO participaciones_liceo (proceso_id, liceo_id, estado) VALUES ($1, $2, $3)
             ON CONFLICT (proceso_id, liceo_id) DO UPDATE SET estado = $3`,
            [procesoId, d.liceo_id, datos.participa ? 'PARTICIPA' : 'NO_PARTICIPA']);
        }
      }
      await this.auditoria.registrar(usuarioId, 'MARCAR_RESPUESTA', 'envio_destinatarios', d.id, datos, em);
    });
    return this.detalle(envioId);
  }

  // -------------------------------------------------------------------------
  // Avisos del proveedor de correo (entregado / rebotado)
  // -------------------------------------------------------------------------

  /**
   * Recibe eventos del proveedor (formato Brevo: { event, "message-id", reason }).
   * Acepta un evento o una lista. Devuelve cuántos destinatarios se actualizaron.
   */
  async eventoProveedor(cuerpo: unknown) {
    const eventos = Array.isArray(cuerpo) ? cuerpo : [cuerpo];
    let actualizados = 0;
    for (const ev of eventos as any[]) {
      const id = limpiarMessageId(ev?.['message-id'] ?? ev?.messageId ?? '');
      const tipo = String(ev?.event ?? '').toLowerCase();
      if (!id || !tipo) continue;
      let entrega: string | null = null;
      if (tipo === 'delivered') entrega = 'ENTREGADO';
      else if (['hard_bounce', 'soft_bounce', 'blocked', 'invalid_email', 'error', 'spam'].includes(tipo)) entrega = 'REBOTADO';
      if (!entrega) continue;
      const r = await this.ds.query(
        `UPDATE envio_destinatarios SET entrega = $2::varchar, error = COALESCE($3, error)
          WHERE id_externo = $1 AND NOT (entrega = 'REBOTADO' AND $2::varchar = 'ENTREGADO') RETURNING id`,
        [id, entrega, entrega === 'REBOTADO' ? String(ev.reason ?? tipo).slice(0, 1000) : null]);
      actualizados += filas(r).length;
    }
    return { actualizados };
  }
}
