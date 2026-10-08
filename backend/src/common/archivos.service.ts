import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { mkdir, writeFile, readFile } from 'fs/promises';
import * as path from 'path';

export interface Archivo {
  id: string;
  nombre_original: string;
  ruta: string;
  mime_type: string | null;
  tamano_bytes: number;
}

const EXTENSIONES_PERMITIDAS = new Set([
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.png', '.jpg', '.jpeg', '.txt', '.csv',
]);
export const TAMANO_MAXIMO = 10 * 1024 * 1024; // 10 MB

/** Guarda archivos en disco (carpeta UPLOAD_DIR) y su referencia en la base. */
@Injectable()
export class ArchivosService {
  private readonly dir: string;

  constructor(private readonly ds: DataSource, cfg: ConfigService) {
    this.dir = path.resolve(cfg.get<string>('UPLOAD_DIR') ?? './uploads');
  }

  async guardar(file: Express.Multer.File): Promise<Archivo> {
    if (!file) throw new BadRequestException('No se recibió ningún archivo.');
    if (file.size > TAMANO_MAXIMO) throw new BadRequestException('El archivo supera los 10 MB.');
    const ext = path.extname(file.originalname).toLowerCase();
    if (!EXTENSIONES_PERMITIDAS.has(ext)) {
      throw new BadRequestException(`Tipo de archivo no permitido (${ext || 'sin extensión'}).`);
    }
    await mkdir(this.dir, { recursive: true });
    // El nombre en disco es un UUID: nunca se usa el nombre que mandó el usuario.
    const nombreDisco = `${randomUUID()}${ext}`;
    await writeFile(path.join(this.dir, nombreDisco), file.buffer);
    const [a] = await this.ds.query(
      `INSERT INTO archivos (nombre_original, ruta, mime_type, tamano_bytes)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [file.originalname.slice(0, 255), nombreDisco, file.mimetype, file.size],
    );
    return a;
  }

  async obtener(id: string): Promise<Archivo> {
    const [a] = await this.ds.query(`SELECT * FROM archivos WHERE id = $1`, [id]);
    if (!a) throw new NotFoundException('Archivo no encontrado.');
    return a;
  }

  async leer(a: Archivo): Promise<Buffer> {
    return readFile(path.join(this.dir, path.basename(a.ruta)));
  }
}
