import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

export interface Correo {
  para: string;
  asunto: string;
  texto: string;
  responderA?: string;
  adjuntos?: { nombre: string; contenido: Buffer; tipo?: string | null }[];
}

/**
 * Envío por SMTP. En desarrollo apunta a Mailpit (docker-compose), que atrapa
 * todos los correos y los muestra en http://localhost:8025 sin enviarlos.
 * En producción se configura el SMTP de la fundación: MAIL_FROM es la casilla
 * corporativa desde la que sale todo (así los liceos responden con un simple
 * "Responder"), MAIL_CC recibe copia de cada correo y MAIL_REPLY_TO (opcional)
 * fuerza a dónde llegan las respuestas.
 * Si SMTP_HOST no está definido, funciona en modo simulación (solo registra).
 */
@Injectable()
export class MailerService {
  private readonly log = new Logger('Correo');
  private readonly transporte: nodemailer.Transporter | null;
  private readonly remitente: string;
  /** Copia de cada correo (ej. Max). Varias direcciones separadas por coma. */
  private readonly copia?: string;
  /** Si se define, las respuestas llegan siempre a esta casilla (ej. la de Mónica), sin importar quién envía desde el sistema. */
  private readonly responderPorDefecto?: string;

  constructor(cfg: ConfigService) {
    this.remitente = cfg.get('MAIL_FROM') ?? 'Fundación Carmen Goudie <no-responder@localhost>';
    this.copia = cfg.get<string>('MAIL_CC')?.trim() || undefined;
    this.responderPorDefecto = cfg.get<string>('MAIL_REPLY_TO')?.trim() || undefined;
    const host = cfg.get<string>('SMTP_HOST');
    this.transporte = host
      ? nodemailer.createTransport({
          host,
          port: Number(cfg.get('SMTP_PORT') ?? 587),
          secure: cfg.get('SMTP_SECURE') === 'true',
          auth: cfg.get('SMTP_USER') ? { user: cfg.get('SMTP_USER'), pass: cfg.get('SMTP_PASS') } : undefined,
        })
      : null;
    if (!this.transporte) this.log.warn('SMTP_HOST no definido: los correos NO se envían (modo simulación).');
  }

  get modoSimulacion() {
    return this.transporte === null;
  }

  async enviar(c: Correo): Promise<{ idExterno: string }> {
    if (!this.transporte) {
      this.log.log(`[simulación] → ${c.para}: ${c.asunto}`);
      return { idExterno: `simulado-${Date.now()}-${Math.random().toString(36).slice(2)}` };
    }
    const info = await this.transporte.sendMail({
      from: this.remitente,
      to: c.para,
      cc: this.copia,
      replyTo: this.responderPorDefecto ?? c.responderA,
      subject: c.asunto,
      text: c.texto,
      html: textoAHtml(c.texto),
      attachments: c.adjuntos?.map((a) => ({ filename: a.nombre, content: a.contenido, contentType: a.tipo ?? undefined })),
    });
    return { idExterno: limpiarMessageId(info.messageId) };
  }
}

export function limpiarMessageId(id: string): string {
  return (id ?? '').replace(/^<|>$/g, '').trim();
}

function escapar(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** El cuerpo se escribe como texto plano; se convierte a HTML simple (párrafos y saltos de línea). */
export function textoAHtml(texto: string): string {
  const parrafos = escapar(texto)
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 12px">${p.replace(/\n/g, '<br>')}</p>`)
    .join('');
  return `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#222">${parrafos}</div>`;
}
