import { spawn } from 'child_process';

/** El PDF no se pudo leer (dañado, con contraseña o tardó demasiado). El mensaje se puede mostrar tal cual. */
export class PdfIlegibleError extends Error {}

const MAX_TEXTO = 2_000_000; // caracteres; una cartola real pesa una fracción de esto

/**
 * Saca el texto de un PDF con `pdftotext` (poppler), todo en memoria: el PDF entra por la entrada estándar
 * y el texto sale por la salida estándar. No se crea ningún archivo temporal.
 *
 * Es el único punto que conoce la herramienta: si algún día se cambia por otra, solo se cambia esta función.
 */
export function extraerTexto(pdf: Buffer, tiempoMaximoMs = 10_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('pdftotext', ['-layout', '-enc', 'UTF-8', '-q', '-', '-'], { stdio: ['pipe', 'pipe', 'ignore'] });
    const trozos: Buffer[] = [];
    let largo = 0;
    let excedido = false;

    let vencido = false;
    const reloj = setTimeout(() => { vencido = true; proc.kill('SIGKILL'); }, tiempoMaximoMs);

    proc.stdout.on('data', (c: Buffer) => {
      largo += c.length;
      if (largo > MAX_TEXTO) { excedido = true; proc.kill('SIGKILL'); } else trozos.push(c);
    });
    proc.stdin.on('error', () => undefined); // si el proceso muere antes de leerlo todo
    proc.on('error', (e: NodeJS.ErrnoException) => {
      clearTimeout(reloj);
      reject(e.code === 'ENOENT' ? new Error('El servidor no tiene instalado el lector de PDF (poppler-utils).') : e);
    });
    proc.on('close', (codigo) => {
      clearTimeout(reloj);
      if (codigo === 0 && !excedido) return resolve(Buffer.concat(trozos).toString('utf8'));
      reject(new PdfIlegibleError(vencido || excedido
        ? 'El PDF tardó demasiado o es demasiado grande para leerlo.'
        : 'No se pudo leer el PDF (¿está dañado o protegido con contraseña?).'));
    });
    proc.stdin.end(pdf);
  });
}
