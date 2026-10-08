/**
 * TypeORM (driver postgres) devuelve las filas de un INSERT ... RETURNING
 * directamente, pero las de un UPDATE/DELETE ... RETURNING como [filas, cantidad].
 * Esta función normaliza ambos casos.
 */
export function filas<T = any>(resultado: unknown): T[] {
  if (Array.isArray(resultado) && resultado.length === 2 && Array.isArray(resultado[0]) && typeof resultado[1] === 'number') {
    return resultado[0] as T[];
  }
  return (resultado as T[]) ?? [];
}
