import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { readFile } from 'fs/promises';
import * as path from 'path';
import { ArchivosService } from './archivos.service';
import { AuditoriaService } from './auditoria.service';

export interface LogoFirma {
  contenido: Buffer;
  tipo: string;
}

export type ModoLogo = 'PREDETERMINADO' | 'PERSONALIZADO' | 'NINGUNO';

const CLAVE = 'LOGO_FIRMA';
/** Logo incluido en el sistema (se usa mientras no se suba otro). */
const PREDETERMINADO = path.resolve(process.cwd(), 'assets', 'logo-firma.png');
const TIPOS = new Set(['image/png', 'image/jpeg']);
const TAMANO_MAXIMO = 1024 * 1024; // 1 MB: va en cada correo

/**
 * Logo que va al final de todos los correos, debajo de la firma de texto.
 * Es uno solo para todo el equipo (no es por usuario). Se guarda en memoria
 * después de la primera lectura para no leer el disco en cada correo.
 */
@Injectable()
export class LogoFirmaService {
  private readonly log = new Logger('LogoFirma');
  private cache: { logo: LogoFirma | null } | null = null;

  constructor(
    private readonly ds: DataSource,
    private readonly archivos: ArchivosService,
    private readonly auditoria: AuditoriaService,
  ) {}

  async estado(): Promise<{ modo: ModoLogo; nombre: string | null; actualizadoEn: string | null }> {
    const [c] = await this.ds.query(
      `SELECT c.valor, c.actualizado_en, a.nombre_original FROM configuracion c
         LEFT JOIN archivos a ON a.id = c.archivo_id WHERE c.clave = $1`, [CLAVE]);
    if (!c) return { modo: 'PREDETERMINADO', nombre: null, actualizadoEn: null };
    if (c.valor === 'NINGUNO') return { modo: 'NINGUNO', nombre: null, actualizadoEn: c.actualizado_en };
    if (c.nombre_original) return { modo: 'PERSONALIZADO', nombre: c.nombre_original, actualizadoEn: c.actualizado_en };
    return { modo: 'PREDETERMINADO', nombre: null, actualizadoEn: null }; // el archivo se perdió
  }

  /** Logo que se pone en los correos, o null si los correos van sin logo. */
  async obtener(): Promise<LogoFirma | null> {
    if (this.cache) return this.cache.logo;
    let logo: LogoFirma | null = null;
    try {
      const [c] = await this.ds.query(
        `SELECT c.valor, a.* FROM configuracion c LEFT JOIN archivos a ON a.id = c.archivo_id WHERE c.clave = $1`, [CLAVE]);
      if (c?.valor === 'NINGUNO') logo = null;
      else if (c?.ruta) logo = { contenido: await this.archivos.leer(c), tipo: c.mime_type ?? 'image/png' };
      else logo = { contenido: await readFile(PREDETERMINADO), tipo: 'image/png' };
    } catch (e) {
      // Un problema con el logo no debe impedir enviar correos.
      this.log.warn(`No se pudo leer el logo de la firma: ${(e as Error).message}`);
      logo = null;
    }
    this.cache = { logo };
    return logo;
  }

  async cambiar(file: Express.Multer.File, usuarioId: string) {
    if (!file) throw new BadRequestException('No se recibió ninguna imagen.');
    if (!TIPOS.has(file.mimetype)) throw new BadRequestException('El logo debe ser una imagen PNG o JPG.');
    if (file.size > TAMANO_MAXIMO) throw new BadRequestException('El logo no puede pesar más de 1 MB (va en cada correo).');
    const a = await this.archivos.guardar(file);
    await this.guardar(null, a.id, usuarioId);
    await this.auditoria.registrar(usuarioId, 'CAMBIAR_LOGO_FIRMA', 'configuracion', null, { archivo: a.nombre_original });
    return this.estado();
  }

  /** Los correos salen sin logo. */
  async quitar(usuarioId: string) {
    await this.guardar('NINGUNO', null, usuarioId);
    await this.auditoria.registrar(usuarioId, 'QUITAR_LOGO_FIRMA', 'configuracion', null);
    return this.estado();
  }

  /** Vuelve al logo incluido en el sistema. */
  async restaurar(usuarioId: string) {
    await this.ds.query(`DELETE FROM configuracion WHERE clave = $1`, [CLAVE]);
    this.cache = null;
    await this.auditoria.registrar(usuarioId, 'RESTAURAR_LOGO_FIRMA', 'configuracion', null);
    return this.estado();
  }

  private async guardar(valor: string | null, archivoId: string | null, usuarioId: string) {
    await this.ds.query(
      `INSERT INTO configuracion (clave, valor, archivo_id, actualizado_por, actualizado_en)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (clave) DO UPDATE SET valor = $2, archivo_id = $3, actualizado_por = $4, actualizado_en = NOW()`,
      [CLAVE, valor, archivoId, usuarioId]);
    this.cache = null;
  }
}
