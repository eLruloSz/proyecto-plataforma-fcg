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

  /**
   * Proceso en curso: el ACTIVO o, si aún no se inicia, el que está en
   * preparación (BORRADOR). Lo usan los liceos, que se revisan y editan
   * antes de confirmar el proceso.
   */
  async enCurso(): Promise<Proceso> {
    const [p] = await this.ds.query(
      `SELECT id, nombre, anio, estado, sufijo_id, ultimo_correlativo
         FROM procesos WHERE estado IN ('ACTIVO', 'BORRADOR') ORDER BY anio DESC LIMIT 1`,
    );
    if (!p) throw new NotFoundException('No hay un proceso en curso. Inicia el proceso del año primero.');
    return p;
  }
}