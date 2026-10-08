import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';

export interface Proceso {
  id: string;
  nombre: string;
  anio: number;
  estado: string;
  sufijo_id: string;
  ultimo_correlativo: number;
}

/**
 * El sistema trabaja sobre un proceso a la vez: el proceso ACTIVO más reciente.
 * Los procesos de años anteriores quedan guardados como historial.
 */
@Injectable()
export class ProcesoActualService {
  constructor(private readonly ds: DataSource) {}

  async obtener(): Promise<Proceso> {
    const [p] = await this.ds.query(
      `SELECT id, nombre, anio, estado, sufijo_id, ultimo_correlativo
         FROM procesos WHERE estado = 'ACTIVO' ORDER BY anio DESC LIMIT 1`,
    );
    if (!p) throw new NotFoundException('No hay un proceso activo. Crea el proceso del año primero.');
    return p;
  }

  async id(): Promise<string> {
    return (await this.obtener()).id;
  }
}
