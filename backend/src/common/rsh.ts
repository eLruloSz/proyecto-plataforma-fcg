/**
 * RSH de un estudiante para mostrar en pantallas, exportaciones y pautas.
 * Desde 2026-11 la fuente es el Excel del ranking ("40%", 0.4, "P").
 * La ficha (tramo leído de la cartola o digitado) es el respaldo: se usa si el ranking no trae el dato
 * o si el ranking dice "P" (pendiente) y después se cargó la cartola.
 * Si la ficha ya tiene tramo, deja de estar pendiente aunque haya quedado marcada así.
 */
export function textoRsh(rankingRsh: unknown, tramoFicha?: number | null, pendienteFicha?: boolean | null): string | null {
  if (rankingRsh !== null && rankingRsh !== undefined && String(rankingRsh).trim() !== '') {
    const s = String(rankingRsh).trim();
    if (/^p/i.test(s)) return tramoFicha ? `${tramoFicha}%` : 'Pendiente';
    const n = Number(s.replace('%', '').replace(',', '.'));
    if (!Number.isFinite(n)) return s;
    return `${n > 0 && n <= 1 ? Math.round(n * 100) : n}%`;
  }
  if (tramoFicha) return `${tramoFicha}%`;
  if (pendienteFicha) return 'Pendiente';
  return null;
}
