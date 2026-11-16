import { api, ErrorApi } from './api';

/**
 * Sube el Word de la pauta ya rellenado al estudiante, en la etapa de esa entrevista.
 * Si el servidor avisa que el Word no trae el código del estudiante (409), pregunta y, si se confirma,
 * lo guarda igual. Devuelve si reemplazó una pauta anterior, o null si se canceló.
 */
export async function subirPautaCompletada(etapaId: string, postulacionId: string, archivo: File): Promise<{ reemplazada: boolean } | null> {
  const enviar = (forzar: boolean) => {
    const datos = new FormData();
    datos.append('archivo', archivo);
    if (forzar) datos.append('forzar', 'true');
    return api.enviarFormulario<{ reemplazada: boolean }>(`/entrevistas/${etapaId}/estudiantes/${postulacionId}/pauta-completada`, datos);
  };
  try {
    return await enviar(false);
  } catch (e) {
    if (e instanceof ErrorApi && e.estado === 409 && e.message.includes('no trae el código')) {
      return window.confirm(`${e.message}\n\n¿Guardarla igual?`) ? enviar(true) : null;
    }
    throw e;
  }
}