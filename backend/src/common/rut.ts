/** Normaliza un RUT chileno a "12345678-9" y valida el dígito verificador. Devuelve null si no es válido. */
export function normalizarRut(entrada: string): string | null {
  const limpio = entrada.replace(/[.\s-]/g, '').toUpperCase();
  const m = limpio.match(/^(\d{7,8})([\dK])$/);
  if (!m) return null;
  const [, cuerpo, dv] = m;
  let suma = 0;
  let mult = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += Number(cuerpo[i]) * mult;
    mult = mult === 7 ? 2 : mult + 1;
  }
  const r = 11 - (suma % 11);
  const esperado = r === 11 ? '0' : r === 10 ? 'K' : String(r);
  return esperado === dv ? `${cuerpo}-${dv}` : null;
}
