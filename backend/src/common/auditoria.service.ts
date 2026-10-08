import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

@Injectable()
export class AuditoriaService {
  private readonly log = new Logger('Auditoria');

  constructor(private readonly ds: DataSource) {}

  /** Registra una acción. Nunca hace fallar la operación principal. */
  async registrar(
    usuarioId: string | null,
    accion: string,
    entidad?: string,
    entidadId?: string | null,
    detalle?: unknown,
    em?: EntityManager,
  ): Promise<void> {
    try {
      await (em ?? this.ds).query(
        `INSERT INTO auditoria (usuario_id, accion, entidad, entidad_id, detalle)
         VALUES ($1, $2, $3, $4, $5)`,
        [usuarioId, accion, entidad ?? null, entidadId ?? null, detalle ? JSON.stringify(detalle) : null],
      );
    } catch (e) {
      this.log.warn(`No se pudo registrar auditoría (${accion}): ${(e as Error).message}`);
    }
  }
}
