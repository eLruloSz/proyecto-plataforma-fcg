/**
 * RSH de un estudiante para mostrar en exportaciones y pautas.
 * Desde 2026-11 la fuente es el Excel del ranking ("40%", 0.4, "P");
 * la ficha (tramo digitado a mano) queda solo como respaldo de datos antiguos.
 */
export function textoRsh(rankingRsh: unknown, tramoFicha?: number | null, pendienteFicha?: boolean | null): string | null {
  if (rankingRsh !== null && rankingRsh !== undefined && String(rankingRsh).trim() !== '') {
    const s = String(rankingRsh).trim();
    if (/^p/i.test(s)) return 'Pendiente';
    const n = Number(s.replace('%', '').replace(',', '.'));
    if (!Number.isFinite(n)) return s;
    return `${n > 0 && n <= 1 ? Math.round(n * 100) : n}%`;
  }
  if (pendienteFicha) return 'Pendiente';
  if (tramoFicha) return `${tramoFicha}%`;
  return null;
}
