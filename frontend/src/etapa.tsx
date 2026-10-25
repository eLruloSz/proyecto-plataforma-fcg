import { createContext, useContext } from 'react';
import type { Etapa } from './api';

/**
 * Etapa en curso y etapa que se está mirando.
 *
 * La etapa en curso es la ACTIVA del proceso. Se puede "mirar" una etapa ya
 * terminada (modo consulta) sin retroceder el proceso: el menú y el Inicio
 * muestran entonces lo de esa etapa, con un aviso para volver.
 */
export type TipoEtapa = 'INVITACION' | 'ENCUENTRO' | 'PRESELECCION' | 'ENTREVISTA' | 'GENERAL';

export function tipoEtapa(e: Pick<Etapa, 'clave' | 'orden'>): TipoEtapa {
  if (e.clave === 'ENCUENTRO') return 'ENCUENTRO';
  if (e.clave === 'PRESELECCION') return 'PRESELECCION';
  if (e.clave === 'ENTREVISTA' || e.clave === 'ENTREVISTA_COMITE') return 'ENTREVISTA';
  if (e.orden === 1) return 'INVITACION';
  return 'GENERAL';
}

export interface ItemMenu { a: string; texto: string }

/** Lo que se trabaja en cada etapa (el menú muestra solo esto, además de Inicio y Comunicación). */
export function menuDeEtapa(e: Etapa): ItemMenu[] {
  const avance = `/avance/${e.id}`;
  switch (tipoEtapa(e)) {
    case 'INVITACION':
      return [
        { a: '/liceos', texto: 'Liceos y nóminas' },
        { a: '/invitados', texto: 'Invitados' },
        { a: '/seguimiento', texto: 'Seguimiento por liceo' },
        { a: avance, texto: 'Quién avanza' },
      ];
    case 'ENCUENTRO':
      return [{ a: avance, texto: 'Encuentro online' }];
    case 'PRESELECCION':
      return [{ a: avance, texto: 'Postulantes y ranking' }];
    case 'ENTREVISTA':
      return [
        { a: `/entrevistas/${e.id}`, texto: 'Calendario de entrevistas' },
        { a: avance, texto: 'Resultados' },
        { a: '/seguimiento', texto: 'Seguimiento por liceo' },
      ];
    default:
      return [{ a: avance, texto: 'Estudiantes de la etapa' }];
  }
}

/** Plantillas de correo que se usan en cada etapa (se sugieren primero al escribir). */
export const PROPOSITOS_DE_ETAPA: Record<TipoEtapa, string[]> = {
  INVITACION: ['PRESENTACION', 'SOLICITUD_NOTAS', 'SOLICITUD_CONTACTOS', 'INVITACION_ESTUDIANTES', 'AGRADECIMIENTO'],
  ENCUENTRO: ['OTRO', 'AVISO_RESULTADO'],
  PRESELECCION: ['OTRO', 'AVISO_RESULTADO', 'INFORME_LICEO'],
  ENTREVISTA: ['AVISO_RESULTADO', 'INFORME_LICEO', 'OTRO'],
  GENERAL: ['AVISO_RESULTADO', 'OTRO'],
};

export interface ContextoEtapa {
  /** Etapa ACTIVA del proceso. */
  actual: Etapa | null;
  /** Etapa que se está mirando (la actual, salvo en modo consulta). */
  vista: Etapa | null;
  /** true si se está mirando una etapa distinta de la actual. */
  consultando: boolean;
  /** Mirar otra etapa (null = volver a la actual). */
  verEtapa: (id: string | null) => void;
}

export const EtapaCtx = createContext<ContextoEtapa>({ actual: null, vista: null, consultando: false, verEtapa: () => {} });
export const useEtapa = () => useContext(EtapaCtx);