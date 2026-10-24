import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ProcesoActualService } from '../common/proceso-actual.service';
import { AuditoriaService } from '../common/auditoria.service';
import { normalizarRut } from '../common/rut';
import { normalizar } from '../nominas/parser';
import {
  CAMPOS, leerRespuestas, limpiarEmail, limpiarTelefono, Mapeo, palabrasNombre, puntajeNombre,
} from './respuestas-formulario';

interface InvitadoBase {
  id: string; codigo: string; nombres: string; apellido_paterno: string; apellido_materno: string | null;
  liceo_id: string; liceo_codigo: string; liceo: string;
  persona_id: string; email: string | null; telefono: string | null; rut: string | null;
}

export interface CambioContacto {
  invitadoId: string;
  email?: string | null;
  telefono?: string | null;
  rut?: string | null;
}

/**
 * Importa el Excel de respuestas del formulario (Microsoft Forms) para cargar
 * email, teléfono y RUT de los invitados sin escribirlos a mano.
 *
 *   1. previsualizar: lee el archivo, calza cada respuesta con un invitado y
 *      muestra qué cambiaría. No guarda nada.
 *   2. confirmar: guarda solo lo que la persona dejó marcado en la pantalla.
 *
 * Calce: primero por RUT (si el invitado ya lo tiene), luego por liceo + nombre.
 */
@Injectable()
export class ImportarContactosService {
  constructor(
    private readonly ds: DataSource,
    private readonly proceso: ProcesoActualService,
    private readonly auditoria: AuditoriaService,
  ) {}

  async previsualizar(file: Express.Multer.File, mapeoTexto?: string) {
    if (!file) throw new BadRequestException('Adjunta el Excel con las respuestas del formulario.');
    if (!/\.xlsx$/i.test(file.originalname)) {
      throw new BadRequestException('El archivo debe ser .xlsx (en Microsoft Forms: "Abrir en Excel" y descargar).');
    }
    let mapeo: Mapeo | undefined;
    if (mapeoTexto) {
      try {
        const m = JSON.parse(mapeoTexto);
        mapeo = Object.fromEntries(CAMPOS.map((c) => [c, Number.isInteger(m?.[c]) && m[c] > 0 ? m[c] : null]));
      } catch { throw new BadRequestException('Las columnas elegidas no son válidas.'); }
    }
    let lectura;
    try {
      lectura = await leerRespuestas(file.buffer, mapeo);
    } catch {
      throw new BadRequestException('No se pudo leer el archivo. ¿Es el Excel descargado desde Microsoft Forms?');
    }

    const procesoId = await this.proceso.id();
    const invitados: InvitadoBase[] = await this.ds.query(
      `SELECT p.id, p.codigo, pe.nombres, pe.apellido_paterno, pe.apellido_materno,
              l.id AS liceo_id, l.codigo AS liceo_codigo, l.nombre AS liceo,
              pe.id AS persona_id, pe.email, pe.telefono, pe.rut
         FROM postulaciones p JOIN personas pe ON pe.id = p.persona_id JOIN liceos l ON l.id = p.liceo_id
        WHERE p.proceso_id = $1
        ORDER BY p.correlativo`, [procesoId]);
    const liceos: { id: string; codigo: string; nombre: string }[] = await this.ds.query(
      `SELECT DISTINCT l.id, l.codigo, l.nombre FROM liceos l JOIN postulaciones p ON p.liceo_id = l.id WHERE p.proceso_id = $1`,
      [procesoId]);
    const porRut = new Map(invitados.filter((i) => i.rut).map((i) => [i.rut!, i]));

    const resumen = (i: InvitadoBase) => ({
      id: i.id, codigo: i.codigo, nombre: `${i.nombres} ${i.apellido_paterno} ${i.apellido_materno ?? ''}`.trim(),
      liceo: `${i.liceo_codigo}. ${i.liceo}`, email: i.email, telefono: i.telefono, rut: i.rut,
    });

    const filas = lectura.respuestas.map((r) => {
      const avisos: string[] = [];
      const email = limpiarEmail(r.email);
      if (email.error) avisos.push(`${email.error}: no se carga el email.`);
      if (email.sugerencia) avisos.push(`¿El email es ${email.sugerencia}? El dominio parece mal escrito.`);
      const tel = limpiarTelefono(r.telefono);
      if (tel.aviso) avisos.push(`Revisa: ${tel.aviso}.`);
      const rut = r.rut ? normalizarRut(r.rut) : null;
      if (r.rut && !rut) avisos.push(`El RUT "${r.rut}" no es válido: no se carga.`);

      const liceo = this.reconocerLiceo(r.liceo, liceos);
      if (r.liceo && !liceo) avisos.push(`No se reconoció el liceo "${r.liceo}"; se buscó en todos.`);

      // 1. Por RUT, siempre que el nombre no contradiga (un RUT mal copiado
      //    podría ser el de otro estudiante).
      let calce: 'CALZA' | 'AMBIGUO' | 'SIN_CALCE' = 'SIN_CALCE';
      let metodo: 'RUT' | 'NOMBRE' | null = null;
      const palabras = palabrasNombre(r.nombre);
      const delRut = rut ? porRut.get(rut) ?? null : null;
      let elegido: InvitadoBase | null = null;
      let candidatos: InvitadoBase[] = [];
      if (delRut && (!palabras.length || puntajeNombre(palabras, delRut) > 0)) { elegido = delRut; calce = 'CALZA'; metodo = 'RUT'; }
      else {
        if (delRut) avisos.push(`El RUT ${rut} es de ${delRut.codigo} (${delRut.nombres} ${delRut.apellido_paterno}), pero el nombre no coincide.`);
        // 2. Por nombre, primero dentro del liceo indicado
        const buscar = (lista: InvitadoBase[]) => {
          const puntajes = lista.map((i) => ({ i, p: puntajeNombre(palabras, i) })).filter((x) => x.p > 0);
          const max = Math.max(0, ...puntajes.map((x) => x.p));
          return puntajes.filter((x) => x.p === max).map((x) => x.i);
        };
        candidatos = liceo ? buscar(invitados.filter((i) => i.liceo_id === liceo.id)) : [];
        if (!candidatos.length) {
          candidatos = buscar(invitados);
          if (candidatos.length && liceo) avisos.push(`El nombre calza con un invitado de otro liceo (${candidatos[0].liceo_codigo}. ${candidatos[0].liceo}).`);
        }
        if (candidatos.length === 1) { elegido = candidatos[0]; calce = 'CALZA'; metodo = 'NOMBRE'; candidatos = []; }
        else if (candidatos.length > 1) calce = 'AMBIGUO';
      }

      return {
        fila: r.fila,
        respuesta: r,
        limpio: { email: email.email, telefono: tel.telefono, rut },
        sugerenciaEmail: email.sugerencia ?? null,
        liceo: liceo ? `${liceo.codigo}. ${liceo.nombre}` : null,
        calce, metodo,
        invitado: elegido ? resumen(elegido) : null,
        candidatos: candidatos.map(resumen),
        avisos,
        repetida: false,
      };
    });

    // Si un mismo invitado respondió dos veces, vale la última respuesta (la fila más abajo).
    const ultima = new Map<string, number>();
    filas.forEach((f, idx) => { if (f.invitado) ultima.set(f.invitado.id, idx); });
    filas.forEach((f, idx) => {
      if (f.invitado && ultima.get(f.invitado.id) !== idx) {
        f.repetida = true;
        f.avisos.push(`Respondió más de una vez: se usa su respuesta de la fila ${filas[ultima.get(f.invitado.id)!].fila}.`);
      }
    });

    // El RUT del formulario no puede ser de otra persona ya registrada.
    const ruts = filas.map((f) => f.limpio.rut).filter((x): x is string => !!x);
    const ocupados: { rut: string; persona_id: string }[] = ruts.length
      ? await this.ds.query(`SELECT rut, id AS persona_id FROM personas WHERE rut = ANY($1::varchar[])`, [ruts]) : [];
    const duenoRut = new Map(ocupados.map((o) => [o.rut, o.persona_id]));
    const personaDe = new Map(invitados.map((i) => [i.id, i.persona_id]));
    for (const f of filas) {
      const dueno = f.limpio.rut ? duenoRut.get(f.limpio.rut) : undefined;
      if (dueno && f.invitado && dueno !== personaDe.get(f.invitado.id)) {
        f.avisos.push(`El RUT ${f.limpio.rut} ya está registrado en otra persona: no se carga.`);
        f.limpio.rut = null;
      }
    }

    const cuenta = (c: string) => filas.filter((f) => f.calce === c && !f.repetida).length;
    return {
      hoja: lectura.hoja,
      columnas: lectura.columnas,
      mapeo: lectura.mapeo,
      resumen: {
        respuestas: filas.length, calzan: cuenta('CALZA'), ambiguas: cuenta('AMBIGUO'),
        sinCalce: cuenta('SIN_CALCE'), repetidas: filas.filter((f) => f.repetida).length,
      },
      filas,
    };
  }

  /** Guarda email, teléfono y RUT de los invitados elegidos en la pantalla. Todo o nada. */
  async confirmar(cambios: CambioContacto[], usuarioId: string) {
    const procesoId = await this.proceso.id();
    const ids = cambios.map((c) => c.invitadoId);
    if (new Set(ids).size !== ids.length) throw new BadRequestException('Hay un invitado elegido en más de una fila.');

    const personas: { id: string; persona_id: string; codigo: string }[] = await this.ds.query(
      `SELECT p.id, p.persona_id, p.codigo FROM postulaciones p WHERE p.id = ANY($1::uuid[]) AND p.proceso_id = $2`,
      [ids, procesoId]);
    const persona = new Map(personas.map((p) => [p.id, p]));

    const errores: string[] = [];
    const listos = cambios.map((c) => {
      const p = persona.get(c.invitadoId);
      if (!p) { errores.push('Uno de los invitados ya no existe.'); return null; }
      const datos: Record<string, string | null> = {};
      if (c.email !== undefined) {
        const e = limpiarEmail(c.email);
        if (c.email && !e.email) errores.push(`${p.codigo}: el email "${c.email}" no es válido.`);
        datos.email = e.email;
      }
      if (c.telefono !== undefined) datos.telefono = limpiarTelefono(c.telefono).telefono;
      if (c.rut !== undefined) {
        const r = c.rut ? normalizarRut(c.rut) : null;
        if (c.rut && !r) errores.push(`${p.codigo}: el RUT "${c.rut}" no es válido.`);
        datos.rut = r;
      }
      return { persona_id: p.persona_id, datos };
    });
    if (errores.length) throw new BadRequestException(errores.join(' '));

    await this.ds.transaction(async (em) => {
      for (const x of listos) {
        const cols = Object.keys(x!.datos);
        if (!cols.length) continue;
        try {
          await em.query(
            `UPDATE personas SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1`,
            [x!.persona_id, ...cols.map((c) => x!.datos[c])]);
        } catch (e: any) {
          if (e.code === '23505') throw new ConflictException('Uno de los RUT ya está registrado en otra persona.');
          throw e;
        }
      }
      await this.auditoria.registrar(usuarioId, 'IMPORTAR_CONTACTOS', 'postulaciones', null, { invitados: ids.length }, em);
    });
    return { actualizados: listos.length };
  }

  /** "16. Colegio NSA", "16", "Colegio Nuestra Señora de Andacollo" → el liceo. */
  private reconocerLiceo(texto: string | null, liceos: { id: string; codigo: string; nombre: string }[]) {
    if (!texto) return null;
    const num = texto.trim().match(/^0*(\d{1,3})\b/);
    if (num) {
      const l = liceos.find((x) => Number(x.codigo) === Number(num[1]));
      if (l) return l;
    }
    const ignorar = new Set(['liceo', 'colegio', 'de', 'del', 'la', 'el', 'los', 'las', 'y', 'escuela', 'instituto', 'bicentenario', 'excelencia']);
    const palabras = (s: string) => normalizar(s).split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !ignorar.has(w));
    const buscadas = palabras(texto);
    if (!buscadas.length) return null;
    const puntajes = liceos
      .map((l) => { const p = new Set(palabras(l.nombre)); return { l, n: buscadas.filter((w) => p.has(w)).length }; })
      .filter((x) => x.n > 0)
      .sort((a, b) => b.n - a.n);
    if (!puntajes.length || (puntajes[1] && puntajes[1].n === puntajes[0].n)) return null;
    return puntajes[0].l;
  }
}