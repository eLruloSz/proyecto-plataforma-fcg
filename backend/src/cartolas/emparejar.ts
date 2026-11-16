import { claveNombre, cuerpoRut, Integrante } from './cartola-parser';

/**
 * Reconocer a qué postulante pertenece una cartola. Función pura (sin base de datos): se prueba con listas sueltas.
 *
 * La cartola trae el RUT TAPADO ("4.553.XXX-X"), así que se reconoce por:
 *  1) el RUT del nombre del archivo («cartola_rsh_21764393_…pdf»), si el postulante tiene RUT cargado;
 *  2) el nombre completo en la lista de integrantes (sin importar tildes, orden ni espacios);
 *  3) un nombre aproximado (falta algún nombre de pila): queda marcado para que una persona lo confirme.
 * Si el postulante tiene RUT cargado y no calza con el comienzo del RUT de la cartola, no se empareja (homónimo).
 */

export type MotivoCoincidencia = 'RUT' | 'NOMBRE' | 'NOMBRE_APROXIMADO';

/** Lo mínimo de cada postulante para reconocerlo en una cartola (todo ya normalizado). */
export interface Postulante { id: string; palabras: string[]; paterno: string; primerNombre: string; materno: string; rut: string | null }

export function prepararPostulante(f: { id: string; nombres: string | null; apellido_paterno: string | null; apellido_materno: string | null; rut: string | null }): Postulante {
  return {
    id: f.id,
    palabras: [f.nombres, f.apellido_paterno, f.apellido_materno].filter(Boolean).join(' ').split(/\s+/).map(claveNombre).filter(Boolean),
    paterno: claveNombre(f.apellido_paterno ?? ''),
    primerNombre: claveNombre(String(f.nombres ?? '').split(/\s+/)[0] ?? ''),
    materno: claveNombre(f.apellido_materno ?? ''),
    rut: f.rut ? cuerpoRut(String(f.rut)) : null,
  };
}

/** El integrante de la cartola que corresponde a este postulante, y por qué (nombre completo o aproximado). */
export function buscarIntegrante(p: Postulante, integrantes: Integrante[]): { por: 'NOMBRE' | 'NOMBRE_APROXIMADO'; integrante: Integrante } | null {
  let mejor: { por: 'NOMBRE' | 'NOMBRE_APROXIMADO'; integrante: Integrante } | null = null;
  for (const i of integrantes) {
    if (p.rut && !(i.rutParcial && p.rut.startsWith(i.rutParcial))) continue;
    const largas = p.palabras.filter((w) => w.length >= 3);
    const todas = largas.length >= 2 && largas.every((w) => i.clave.includes(w));
    if (todas && p.palabras.reduce((n, w) => n + w.length, 0) === i.clave.length) return { por: 'NOMBRE', integrante: i };
    const aprox = p.paterno.length >= 3 && p.primerNombre.length >= 3 && i.clave.includes(p.paterno) && i.clave.includes(p.primerNombre)
      && (p.materno.length < 3 || i.clave.includes(p.materno));
    if (aprox) mejor = { por: 'NOMBRE_APROXIMADO', integrante: i };
  }
  return mejor;
}

/** "21764" → "21.764.XXX-X": así viene el RUT tapado en la cartola. */
export const rutTapado = (rutParcial: string | null | undefined) =>
  rutParcial ? `${rutParcial.slice(0, -3)}.${rutParcial.slice(-3)}.XXX-X` : null;

export function emparejar(integrantes: Integrante[], rutArchivo: string | null, postulantes: Postulante[]): { id: string; por: MotivoCoincidencia }[] {
  const hallados: { id: string; por: MotivoCoincidencia }[] = [];
  for (const p of postulantes) {
    if (rutArchivo && p.rut && p.rut === rutArchivo) { hallados.push({ id: p.id, por: 'RUT' }); continue; }
    const m = buscarIntegrante(p, integrantes);
    if (m) hallados.push({ id: p.id, por: m.por });
  }
  return hallados;
}
