// Cliente de la API. Todas las llamadas pasan por aquí: agrega el token y
// convierte los errores del backend en mensajes legibles.

const BASE = '/api';
const CLAVE_TOKEN = 'becas_token';

export function obtenerToken(): string | null {
  try { return localStorage.getItem(CLAVE_TOKEN); } catch { return null; }
}
export function guardarToken(t: string | null) {
  try {
    if (t) localStorage.setItem(CLAVE_TOKEN, t);
    else localStorage.removeItem(CLAVE_TOKEN);
  } catch { /* navegador sin almacenamiento: la sesión dura lo que dure la pestaña */ }
}

export class ErrorApi extends Error {
  constructor(public estado: number, mensaje: string, public datos?: any) {
    super(mensaje);
  }
}

let alExpirar: () => void = () => {};
export function alExpirarSesion(fn: () => void) { alExpirar = fn; }

async function pedir<T>(metodo: string, ruta: string, cuerpo?: unknown): Promise<T> {
  const esForm = cuerpo instanceof FormData;
  const token = obtenerToken();
  const r = await fetch(BASE + ruta, {
    method: metodo,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(cuerpo !== undefined && !esForm ? { 'Content-Type': 'application/json' } : {}),
    },
    body: cuerpo === undefined ? undefined : esForm ? (cuerpo as FormData) : JSON.stringify(cuerpo),
  });
  const texto = await r.text();
  let datos: any = null;
  try { datos = texto ? JSON.parse(texto) : null; } catch { datos = texto; }
  if (!r.ok) {
    if (r.status === 401 && ruta !== '/auth/login') alExpirar();
    const msg = Array.isArray(datos?.message) ? datos.message.join(' ') : datos?.message ?? `Error ${r.status}`;
    throw new ErrorApi(r.status, msg, datos);
  }
  return datos as T;
}

export const api = {
  get: <T>(ruta: string) => pedir<T>('GET', ruta),
  post: <T>(ruta: string, cuerpo?: unknown) => pedir<T>('POST', ruta, cuerpo ?? {}),
  patch: <T>(ruta: string, cuerpo: unknown) => pedir<T>('PATCH', ruta, cuerpo),
  put: <T>(ruta: string, cuerpo: unknown) => pedir<T>('PUT', ruta, cuerpo),
  del: <T>(ruta: string) => pedir<T>('DELETE', ruta),
  /** POST multipart con varios campos (archivo + datos). */
  enviarFormulario: <T>(ruta: string, datos: FormData) => pedir<T>('POST', ruta, datos),
  subir: <T>(ruta: string, archivo: File) => {
    const f = new FormData();
    f.append('archivo', archivo);
    return pedir<T>('POST', ruta, f);
  },
  /** Descarga con el token (un <a href> no lo enviaría). */
  descargar: async (ruta: string, nombre: string) => {
    const r = await fetch(BASE + ruta, { headers: { Authorization: `Bearer ${obtenerToken()}` } });
    if (!r.ok) throw new ErrorApi(r.status, 'No se pudo descargar el archivo.');
    const url = URL.createObjectURL(await r.blob());
    const a = Object.assign(document.createElement('a'), { href: url, download: nombre });
    a.click();
    URL.revokeObjectURL(url);
  },
};

// ---------------------------------------------------------------------------
// Tipos de la API
// ---------------------------------------------------------------------------

export interface Etapa {
  id: string; orden: number; nombre: string; descripcion: string | null; estado: 'PENDIENTE' | 'ACTIVA' | 'CERRADA'; clave: string | null;
  fecha_inicio: string | null; fecha_fin: string | null; cupo: number | null; estudiantes: number; requisitos: number;
}
export interface Proceso { id: string; nombre: string; anio: number; sufijo_id: string; ultimo_correlativo: number; etapas: Etapa[] }
export interface BorradorProceso {
  id: string; nombre: string; anio: number;
  etapas: { orden: number; nombre: string; cupo: number | null; requisitos: number }[];
}
/** GET /proceso/inicio: si no hay proceso activo se muestra la pantalla "Iniciar proceso". */
export interface InicioProceso {
  activo: { id: string; nombre: string; anio: number } | null;
  borrador: BorradorProceso | null;
  ultimo: { nombre: string; anio: number } | null;
  anioSugerido: number;
}
export interface Contacto { id: string; nombre: string; cargo: string | null; email: string | null; telefono: string | null }
export type Participacion = 'PENDIENTE' | 'PARTICIPA' | 'NO_PARTICIPA';
export interface Liceo {
  id: string; codigo: string; nombre: string; comuna: string | null; direccion: string | null; telefono: string | null; activo: boolean;
  participacion: Participacion; participacion_obs: string | null;
  /** Participa en el proceso en curso (al iniciar el proceso se puede dejar fuera solo ese año). */
  incluido: boolean; revisado_en: string | null;
  contraparte: Contacto | null; director: Contacto | null;
  nomina: { carga_id: string; nombre_archivo: string; cargado_en: string; alumnos: number; cursos: number } | null;
  invitados: number;
}
export interface Observacion { hoja?: string; fila?: number; mensaje: string }
export interface Previsualizacion {
  liceo: { id: string; nombre: string; codigo: string };
  liceoEnArchivo: string | null;
  cursos: { curso: string; cursoOriginal: string; especialidad: string | null; hoja: string; alumnos: number }[];
  totalAlumnos: number;
  alumnos: { curso: string; nombres: string; apellidoPaterno: string; apellidoMaterno: string | null; promedio1m: number | null; promedio2m: number | null; promedio: number; posicionCurso: number }[];
  errores: Observacion[];
  advertencias: Observacion[];
}
export interface AlumnoNomina {
  id: string; curso: string; n_lista: number | null; apellido_paterno: string; apellido_materno: string | null; nombres: string;
  promedio_1m: number | null; promedio_2m: number | null; promedio: number; posicion_curso: number;
  /** Lugar entre todos los alumnos de la nómina del liceo (empates comparten lugar). */
  posicion_liceo: number;
  postulacion_id: string | null; codigo: string | null; sugerido: boolean;
}
/** liceo: los N mejores del liceo sin importar el curso · curso: los N mejores de cada curso. */
export type ModoSugerencia = 'liceo' | 'curso';
export interface Nomina {
  liceo: { id: string; nombre: string; codigo: string };
  carga: { id: string; nombre_archivo: string; cargado_en: string; advertencias: Observacion[] } | null;
  modo: ModoSugerencia; n: number;
  /** Todos los alumnos del liceo en una sola lista, del mejor al peor promedio. */
  alumnos: AlumnoNomina[];
  cursos: { curso: string; especialidad: string | null; alumnos: AlumnoNomina[] }[];
}
export type Confirmacion = 'PENDIENTE' | 'CONFIRMADO' | 'RECHAZADO';
export interface Invitado {
  id: string; codigo: string; curso: string; promedio: number; posicion_curso: number; estado: string;
  /** Lugar entre todos los alumnos de la nómina de su liceo, y cuántos son (null si ya no hay nómina). */
  posicion_liceo: number | null; alumnos_liceo: number | null;
  confirmacion: Confirmacion; confirmacion_en: string | null; encuentro_evento_id: string | null; asistio_encuentro: boolean | null;
  nombres: string; apellido_paterno: string; apellido_materno: string | null; email: string | null; telefono: string | null; rut: string | null;
  liceo_id: string; liceo_codigo: string; liceo: string; comentarios: number;
  etapa_id: string | null; etapa: string | null; etapa_orden: number | null;
  resultado_etapa: 'PASA' | 'NO_PASA' | null; resultado_confirmado: boolean; faltan: string[];
}
/** Importación del Excel de respuestas del formulario (Microsoft Forms). */
export type CampoFormulario = 'nombre' | 'apellido1' | 'apellido2' | 'rut' | 'liceo' | 'email' | 'telefono';
export interface InvitadoResumen { id: string; codigo: string; nombre: string; liceo: string; email: string | null; telefono: string | null; rut: string | null }
export interface FilaFormulario {
  fila: number;
  respuesta: { nombre: string | null; rut: string | null; liceo: string | null; email: string | null; telefono: string | null };
  /** Datos ya validados y normalizados (null si no son válidos). */
  limpio: { email: string | null; telefono: string | null; rut: string | null };
  sugerenciaEmail: string | null;
  liceo: string | null;
  calce: 'CALZA' | 'AMBIGUO' | 'SIN_CALCE';
  metodo: 'RUT' | 'NOMBRE' | null;
  invitado: InvitadoResumen | null;
  candidatos: InvitadoResumen[];
  avisos: string[];
  repetida: boolean;
}
export interface PreviaFormulario {
  hoja: string;
  columnas: { indice: number; titulo: string; ejemplo: string | null }[];
  mapeo: Record<CampoFormulario, number | null>;
  resumen: { respuestas: number; calzan: number; ambiguas: number; sinCalce: number; repetidas: number };
  filas: FilaFormulario[];
}
export interface Encuentro { id: string; fecha: string; enlace: string | null; inscritos: number; asistentes: number }
export type Grupo = 'CONTRAPARTES' | 'DIRECTORES' | 'LICEO' | 'POSTULANTES';
export interface Plantilla {
  id: string; nombre: string; proposito: string; asunto: string; cuerpo: string;
  adjuntos: { id: string; nombre: string; tamano: number }[];
}
export interface EnvioResumen {
  id: string; grupo: Grupo; proposito: string; asunto: string; total: number; enviado_en: string; envio_origen_id: string | null;
  enviado_por: string | null; enviados: number; con_problema: number; en_cola: number; respondidos: number; sin_respuesta: number; adjuntos: number;
}
export interface Destinatario {
  id: string; liceo_id: string | null; postulacion_id: string | null; nombre: string; email: string;
  entrega: 'PENDIENTE' | 'ENVIADO' | 'ENTREGADO' | 'REBOTADO' | 'FALLIDO'; error: string | null;
  respuesta: 'PENDIENTE' | 'RESPONDIDO'; respuesta_nota: string | null; respuesta_auto: boolean; respondido_en: string | null;
  respondido_por: string | null; asunto_final: string; cuerpo_final: string; liceo: string | null; codigo: string | null; participacion: Participacion;
}
export interface EnvioDetalle {
  id: string; grupo: Grupo; proposito: string; asunto: string; asunto_visible: string; cuerpo: string; total: number; enviado_en: string;
  enviado_por_nombre: string | null; envio_origen_id: string | null; plantilla_id: string | null;
  destinatarios: Destinatario[]; adjuntos: { id: string; nombre_original: string; tamano_bytes: number }[];
}
export interface PreviaEnvio {
  grupo: Grupo;
  destinatarios: { clave: string; liceoId: string | null; postulacionId: string | null; nombre: string; cargo: string | null; email: string; liceo: string; asunto: string; cuerpo: string }[];
  excluidos: { clave: string; nombre: string; liceo: string; motivo: string }[];
  advertencias: string[];
}
export type TipoFiltroEtapa = 'EN_ETAPA' | 'FALTAN_REQUISITOS' | 'PASA' | 'NO_PASA';
export interface FiltroEtapa { etapaId: string; tipo: TipoFiltroEtapa; soloSinAviso?: boolean }
export interface SolicitudEnvio {
  grupo: Grupo; proposito?: string; asunto: string; cuerpo: string; plantillaId?: string; adjuntoIds?: string[];
  liceoIds?: string[]; postulacionIds?: string[]; envioOrigenId?: string; excluir?: string[]; filtroEtapa?: FiltroEtapa;
}
export interface Dashboard {
  proceso: { id: string; nombre: string; anio: number };
  embudo: { invitados: number; confirmaron: number; rechazaron: number; sin_respuesta: number; asistieron_encuentro: number; becarios: number; sin_email: number };
  porEtapa: { id: string; orden: number; nombre: string; estado: Etapa['estado']; cupo: number | null; llegaron: number; en_etapa: number }[];
  pendientes: {
    con_requisitos_pendientes: number;
    requisitos: { etapa_id: string; etapa: string; requisito: string; faltan: number }[];
    resultados: { etapa_id: string; etapa: string; sin_confirmar: number; sin_avisar: number }[];
  };
  liceos: { total: number; participan: number; no_participan: number; sin_respuesta: number; con_nomina: number };
  porLiceo: { id: string; codigo: string; nombre: string; participacion: Participacion; alumnos_nomina: number; invitados: number; confirmaron: number; sin_respuesta: number }[];
  correosPendientes: { id: string; asunto: string; grupo: Grupo; enviado_en: string; total: number; sin_respuesta: number }[];
  rebotados: number;
}
export interface GrillaHitos {
  catalogo: { codigo: string; nombre: string; orden: number }[];
  filas: { id: string; codigo: string; nombre: string; comuna: string | null; contraparte: string | null; contraparte_cargo: string | null; participacion: Participacion;
    hitos: Record<string, { completado: boolean; automatico: boolean; fecha: string | null; observaciones: string | null }> }[];
}

export interface VistaAvance {
  etapa: Etapa & { siguiente: { id: string; orden: number; nombre: string } | null; anterior: { id: string; orden: number; nombre: string } | null };
  requisitos: { id: string; nombre: string; orden: number }[];
  estudiantes: {
    id: string; codigo: string; curso: string; promedio: number; estado: string; confirmacion: Confirmacion;
    nombres: string; apellido_paterno: string; apellido_materno: string | null; email: string | null;
    liceo_id: string; liceo_codigo: string; liceo: string; en_esta_etapa: boolean;
    resultado: 'PASA' | 'NO_PASA' | null; confirmado: boolean; confirmado_en: string | null; avisado_en: string | null; cumplidos: string[];
    ficha: FichaPostulacion | null;
    ranking: RankingEstudiante | null;
    entrevista_fecha?: string | null; entrevista_estado?: EstadoEntrevista | null; entrevista_realizada?: boolean;
    encuentro_evento_id: string | null; asistio_encuentro: boolean | null;
  }[];
  resumen: {
    total: number; pendientes_de_decidir: number; marcados_pasa: number; marcados_no_pasa: number;
    confirmados_pasa: number; confirmados_no_pasa: number; sin_avisar_pasa: number; sin_avisar_no_pasa: number; con_requisitos_pendientes: number;
    sin_entrevistar?: number;
  };
}

// --- Preselección N°1: ficha de postulación y ranking ------------------------
/** Datos que la fundación digita mirando la cartola del RSH (la cartola no se guarda). */
export interface FichaPostulacion {
  tramo_rsh: number | null; rsh_pendiente: boolean; rsh_actualizada: string | null;
  personas_hogar: number | null; menores_18: number | null; mayores_60: number | null;
  con_discapacidad: number | null; con_dependencia: number | null; con_invalidez: number | null; con_nee: number | null;
  ingresos_hogar: string | null; personas_formulario: number | null; observaciones: string | null; actualizado_en: string;
}
export interface RankingEstudiante {
  posicion: number | null; puntaje_total: number | null; puntaje_academico: number | null;
  puntaje_socioeconomico: number | null; puntaje_compromiso: number | null; finalista: boolean; rsh: string | null;
}
export interface FilaRankingPrevia {
  fila: number; id: string | null; establecimiento: string | null; apellidoPaterno: string | null; apellidoMaterno: string | null; nombre: string | null;
  notas: number | null; puntajeAcademico: number | null; rsh: string | null; puntajeSocioeconomico: number | null; puntajeCompromiso: number | null;
  puntajeTotal: number | null; finalista: boolean; posicion: number | null;
  postulacion: { id: string; codigo: string; nombre: string; liceo: string } | null; avisos: string[];
}
export interface PreviaRanking {
  hojas: { nombre: string; filas: number }[]; hoja: string | null; filas: FilaRankingPrevia[]; advertencias: string[];
  anterior: { nombre_archivo: string; cargado_en: string } | null;
  resumen: { filas: number; calzan: number; sinCalce: number; finalistas: number; conAvisos: number };
}
export interface CargaRanking { carga: { id: string; nombre_archivo: string; cargado_en: string; filas_ok: number; advertencias: Observacion[] } | null }

// --- Tareas de la etapa (pantalla de Inicio) ---------------------------------
export interface TareaEtapa { clave: string; titulo: string; detalle: string; hecha: boolean; accion?: { texto: string; ruta: string } }
export interface TareasEtapa {
  etapa: Etapa & { tipo: 'INVITACION' | 'ENCUENTRO' | 'PRESELECCION' | 'ENTREVISTA' | 'GENERAL' };
  siguiente: { id: string; orden: number; nombre: string } | null;
  total_etapas: number;
  resumen: VistaAvance['resumen'] & { en_etapa: number };
  tareas: TareaEtapa[];
  /** Todas las tareas hechas: se puede terminar la etapa. */
  lista: boolean;
}

// --- Calendario de entrevistas ----------------------------------------------
export type EstadoEntrevista = 'POR_SOLICITAR' | 'SOLICITADA' | 'CONFIRMADA' | 'REALIZADA' | 'CANCELADA' | 'CONFLICTO';
export interface EntrevistaAgenda { fecha_hora: string | null; estado: EstadoEntrevista; comentario: string | null; actualizado_en: string }
export interface EstudianteAgenda {
  id: string; codigo: string; nombres: string; apellido_paterno: string; apellido_materno: string | null;
  email: string | null; telefono: string | null; liceo_codigo: string; liceo: string;
  en_esta_etapa: boolean; resultado: 'PASA' | 'NO_PASA' | null; confirmado: boolean;
  entrevista: EntrevistaAgenda | null;
}
/** Bloqueo de agenda: un día completo (hora null) o un bloque ("HH:MM"). */
export interface BloqueoAgenda { id: string; fecha: string; hora: string | null; motivo: string }
export interface CalendarioEntrevistas {
  etapa: { id: string; orden: number; nombre: string; clave: string | null; cupo: number | null; estado: string; horas: string[] };
  estudiantes: EstudianteAgenda[];
  bloqueos: BloqueoAgenda[];
}

// --- Histórico de generaciones ---------------------------------------------
/** Foto de un año. En las generaciones ingresadas a mano, null = sin dato. */
export interface EtapaResumen {
  orden: number; nombre: string; cupo: number | null; llegaron: number | null; fecha_inicio: string | null; fecha_fin: string | null;
}
export interface ResumenGeneracion {
  liceos: { convocados: number | null; con_invitados: number | null };
  invitados: number | null;
  aceptaron: number | null;
  becarios: number | null;
  etapas: EtapaResumen[];
  /** Solo en el detalle. llegaron[i] corresponde a etapas[i]. */
  por_liceo?: { codigo: string; nombre: string; invitados: number; aceptaron: number; llegaron: number[]; becarios: number }[];
  lista_becarios?: { codigo: string | null; nombre: string; liceo: string | null }[];
  material?: {
    nominas: number;
    ranking: { nombre_archivo: string; cargado_en: string } | null;
    entrevistas: number;
    envios: { asunto: string; proposito: string; grupo: Grupo; total: number; enviado_en: string }[];
    correos: number;
  } | null;
}
export interface Generacion {
  anio: number; nombre: string; estado: 'ACTIVO' | 'CERRADO'; historico: boolean;
  inicio: string | null; cerrado_en: string | null; observaciones: string | null;
  resumen: ResumenGeneracion | null;
}
/** Lo que se envía para crear o corregir una generación ingresada a mano. */
export interface GeneracionHistoricaDatos {
  anio: number; liceos: number | null; invitados: number | null; aceptaron: number | null; becarios: number | null;
  etapas: { nombre: string; llegaron: number | null }[];
  listaBecarios: { nombre: string; liceo: string | null }[];
  observaciones: string | null;
}

// Textos para mostrar
export const PROPOSITOS: Record<string, string> = {
  PRESENTACION: 'Presentación a liceos',
  SOLICITUD_NOTAS: 'Solicitud de notas',
  SOLICITUD_CONTACTOS: 'Aprobación de invitados y contactos',
  INVITACION_ESTUDIANTES: 'Invitación a estudiantes',
  AVISO_RESULTADO: 'Aviso de resultado',
  AGRADECIMIENTO: 'Agradecimiento',
  INFORME_LICEO: 'Informe de estudiantes al liceo',
  OTRO: 'Otro',
};
export const GRUPOS: Record<Grupo, string> = {
  CONTRAPARTES: 'Todas las contrapartes',
  DIRECTORES: 'Todos los directores',
  LICEO: 'Liceos específicos',
  POSTULANTES: 'Estudiantes invitados',
};