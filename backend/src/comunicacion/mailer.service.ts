import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LogoFirmaService } from '../common/logo-firma.service';
import * as nodemailer from 'nodemailer';

export interface Correo {
  para: string;
  /** Copia (CC). */
  cc?: string[];
  asunto: string;
  texto: string;
  responderA?: string;
  adjuntos?: { nombre: string; contenido: Buffer; tipo?: string | null }[];
}

/**
 * Envío por SMTP. En desarrollo apunta a Mailpit (docker-compose), que atrapa
 * todos los correos y los muestra en http://localhost:8025 sin enviarlos.
 * En producción se configura el SMTP del proveedor (ej. Brevo).
 * Si SMTP_HOST no está definido, funciona en modo simulación (solo registra).
 *
 * MAIL_REDIRIGIR_A: si está definido, TODOS los correos se envían a esa casilla
 * (y no al destinatario real), con el destinatario original en el asunto y al
 * inicio del cuerpo. Sirve para probar con un SMTP real sin escribirle a los
 * liceos ni a los estudiantes. En producción debe quedar vacío.
 *
 * Todos los correos llevan al final el logo de la firma (LogoFirmaService), como
 * imagen incrustada (cid), salvo que se haya quitado desde Mi perfil.
 */
@Injectable()
export class MailerService {
  private readonly log = new Logger('Correo');
  private readonly transporte: nodemailer.Transporter | null;
  private readonly remitente: string;
  private readonly redirigirA: string | null;

  constructor(cfg: ConfigService, private readonly logo: LogoFirmaService) {
    this.remitente = cfg.get('MAIL_FROM') ?? 'Fundación Carmen Goudie <no-responder@localhost>';
    this.redirigirA = cfg.get<string>('MAIL_REDIRIGIR_A')?.trim() || null;
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
    else if (this.redirigirA) this.log.warn(`MAIL_REDIRIGIR_A activo: todos los correos se envían a ${this.redirigirA}.`);
  }

  get modoSimulacion() {
    return this.transporte === null;
  }

  async enviar(c: Correo): Promise<{ idExterno: string }> {
    if (!this.transporte) {
      this.log.log(`[simulación] → ${c.para}${c.cc?.length ? ` (cc: ${c.cc.join(', ')})` : ''}: ${c.asunto}`);
      return { idExterno: `simulado-${Date.now()}-${Math.random().toString(36).slice(2)}` };
    }
    const desvio = this.redirigirA ? `[Prueba — para: ${c.para}] ` : '';
    // Con el desvío de prueba tampoco sale la copia: se indica en el texto a quién habría ido.
    const texto = this.redirigirA
      ? `(Correo de prueba desviado. Destinatario real: ${c.para}${c.cc?.length ? ` · CC: ${c.cc.join(', ')}` : ''})\n\n${c.texto}`
      : c.texto;
    const logo = await this.logo.obtener();
    const info = await this.transporte.sendMail({
      from: this.remitente,
      to: this.redirigirA ?? c.para,
      cc: this.redirigirA || !c.cc?.length ? undefined : c.cc,
      replyTo: c.responderA,
      subject: desvio + c.asunto,
      text: texto,
      html: textoAHtml(texto, !!logo),
      attachments: [
        ...(c.adjuntos?.map((a) => ({ filename: a.nombre, content: a.contenido, contentType: a.tipo ?? undefined })) ?? []),
        // Imagen incrustada: se muestra en el cuerpo, no como adjunto.
        // contentDisposition 'inline' + cid: los clientes (Gmail, Outlook) la muestran solo dentro del texto.
        ...(logo ? [{
          filename: logo.tipo === 'image/jpeg' ? 'logo.jpg' : 'logo.png', content: logo.contenido, contentType: logo.tipo,
          cid: CID_LOGO, contentDisposition: 'inline' as const,
        }] : []),
      ],
    });
    return { idExterno: limpiarMessageId(info.messageId) };
  }
}

const CID_LOGO = 'logo-firma@fundacion';

export function limpiarMessageId(id: string): string {
  return (id ?? '').replace(/^<|>$/g, '').trim();
}

function escapar(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** El cuerpo se escribe como texto plano; se convierte a HTML simple (párrafos y saltos de línea). */
export function textoAHtml(texto: string, conLogo = false): string {
  const parrafos = escapar(texto)
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 12px">${p.replace(/\n/g, '<br>')}</p>`)
    .join('');
  // Logo de la firma: 240 px de ancho (la imagen es de 480 px para pantallas de alta densidad).
  const logo = conLogo
    ? `<p style="margin:16px 0 0"><img src="cid:${CID_LOGO}" alt="Fundación Carmen Goudie" width="240"`
      + ` style="display:block;width:240px;max-width:100%;height:auto;border:0"></p>`
    : '';
  return `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#222">${parrafos}${logo}</div>`;
}
