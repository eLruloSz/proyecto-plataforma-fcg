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

export interface Etapa { id: string; orden: number; nombre: string; descripcion: string | null; estado: 'PENDIENTE' | 'ACTIVA' | 'CERRADA'; fecha_inicio: string | null; fecha_fin: string | null }
export interface Proceso { id: string; nombre: string; anio: number; sufijo_id: string; ultimo_correlativo: number; etapas: Etapa[] }
export interface Contacto { id: string; nombre: string; cargo: string | null; email: string | null; telefono: string | null }
export type Participacion = 'PENDIENTE' | 'PARTICIPA' | 'NO_PARTICIPA';
export interface Liceo {
  id: string; codigo: string; nombre: string; comuna: string | null; direccion: string | null; telefono: string | null; activo: boolean;
  participacion: Participacion; participacion_obs: string | null;
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
  postulacion_id: string | null; codigo: string | null; sugerido: boolean;
}
export interface Nomina {
  liceo: { id: string; nombre: string; codigo: string };
  carga: { id: string; nombre_archivo: string; cargado_en: string; advertencias: Observacion[] } | null;
  cursos: { curso: string; especialidad: string | null; alumnos: AlumnoNomina[] }[];
}
export type Confirmacion = 'PENDIENTE' | 'CONFIRMADO' | 'RECHAZADO';
export interface Invitado {
  id: string; codigo: string; curso: string; promedio: number; posicion_curso: number; estado: string;
  confirmacion: Confirmacion; confirmacion_en: string | null; encuentro_evento_id: string | null; asistio_encuentro: boolean | null;
  nombres: string; apellido_paterno: string; apellido_materno: string | null; email: string | null; telefono: string | null; rut: string | null;
  liceo_id: string; liceo_codigo: string; liceo: string; comentarios: number;
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
export interface SolicitudEnvio {
  grupo: Grupo; proposito?: string; asunto: string; cuerpo: string; plantillaId?: string; adjuntoIds?: string[];
  liceoIds?: string[]; postulacionIds?: string[]; envioOrigenId?: string; excluir?: string[];
}
export interface Dashboard {
  proceso: { id: string; nombre: string; anio: number };
  embudo: { invitados: number; confirmaron: number; rechazaron: number; sin_respuesta: number; asistieron_encuentro: number; postularon: number; preseleccionados: number; finalistas: number; becarios: number; sin_email: number };
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

// Textos para mostrar
export const PROPOSITOS: Record<string, string> = {
  PRESENTACION: 'Presentación a liceos',
  SOLICITUD_NOTAS: 'Solicitud de notas',
  SOLICITUD_CONTACTOS: 'Aprobación de invitados y contactos',
  INVITACION_ESTUDIANTES: 'Invitación a estudiantes',
  AVISO_RESULTADO: 'Aviso de resultado',
  AGRADECIMIENTO: 'Agradecimiento',
  OTRO: 'Otro',
};
export const GRUPOS: Record<Grupo, string> = {
  CONTRAPARTES: 'Todas las contrapartes',
  DIRECTORES: 'Todos los directores',
  LICEO: 'Liceos específicos',
  POSTULANTES: 'Estudiantes invitados',
};
