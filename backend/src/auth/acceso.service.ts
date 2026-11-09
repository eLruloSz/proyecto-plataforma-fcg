import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import { createHash, randomBytes } from 'crypto';
import { MailerService } from '../comunicacion/mailer.service';

export type TipoEnlace = 'INVITACION' | 'RESTABLECER';

/** Duración de cada tipo de enlace. */
const VIGENCIA_MIN: Record<TipoEnlace, number> = {
  INVITACION: 48 * 60, // 48 horas
  RESTABLECER: 60,     // 1 hora
};

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * Enlaces de un solo uso para crear la contraseña (invitación) o
 * restablecerla ("¿Olvidaste tu contraseña?").
 *
 * - El token es aleatorio (32 bytes) y en la base se guarda solo su SHA-256:
 *   si alguien lee la base no puede usar los enlaces.
 * - Al crear un enlace nuevo se anulan los anteriores del mismo tipo.
 * - El token va en el fragmento de la URL (#t=...), que el navegador no envía
 *   al servidor ni deja en los logs ni en el encabezado Referer.
 */
@Injectable()
export class AccesoService {
  private readonly log = new Logger('Acceso');

  constructor(
    private readonly ds: DataSource,
    private readonly cfg: ConfigService,
    private readonly mailer: MailerService,
  ) {}

  private urlBase() {
    const explicita = this.cfg.get<string>('APP_URL');
    const cors = (this.cfg.get<string>('CORS_ORIGINS') ?? 'http://localhost:5173').split(',')[0].trim();
    return (explicita || cors).replace(/\/+$/, '');
  }

  async crearEnlace(usuarioId: string, tipo: TipoEnlace, creadoPor: string | null, em?: EntityManager): Promise<string> {
    const q = em ?? this.ds;
    await q.query(
      `UPDATE tokens_usuario SET usado_en = NOW() WHERE usuario_id = $1 AND tipo = $2 AND usado_en IS NULL`,
      [usuarioId, tipo],
    );
    const token = randomBytes(32).toString('base64url');
    await q.query(
      `INSERT INTO tokens_usuario (usuario_id, tipo, token_hash, expira_en, creado_por)
       VALUES ($1, $2, $3, NOW() + make_interval(mins => $4), $5)`,
      [usuarioId, tipo, hash(token), VIGENCIA_MIN[tipo], creadoPor],
    );
    return token;
  }

  /** Envía el correo con el enlace. */
  async enviarCorreo(u: { email: string; nombre: string }, tipo: TipoEnlace, token: string, invitadoPor?: string | null) {
    const url = `${this.urlBase()}/acceso#t=${token}`;
    const saludo = `Hola ${u.nombre}:`;
    const texto = tipo === 'INVITACION'
      ? `${saludo}\n\n${invitadoPor ? `${invitadoPor} te invitó` : 'Te invitaron'} al sistema de gestión de la Beca Carmen Goudie.\n\n` +
        `Para crear tu contraseña y entrar, abre este enlace:\n${url}\n\n` +
        `El enlace sirve una sola vez y vence en 48 horas. Si vence, pide que te lo reenvíen.\n\n` +
        `Si no esperabas este correo, puedes ignorarlo.`
      : `${saludo}\n\nRecibimos una solicitud para restablecer tu contraseña del sistema de la Beca Carmen Goudie.\n\n` +
        `Para elegir una nueva, abre este enlace:\n${url}\n\n` +
        `El enlace sirve una sola vez y vence en 1 hora.\n\n` +
        `Si no lo pediste tú, ignora este correo: tu contraseña actual sigue funcionando.`;
    await this.mailer.enviar({
      para: u.email,
      asunto: tipo === 'INVITACION' ? 'Invitación al sistema de la Beca Carmen Goudie' : 'Restablecer tu contraseña',
      texto,
    });
  }

  /** Busca un enlace vigente. Lanza error si no existe, ya se usó o venció. */
  async buscarVigente(token: string, em?: EntityManager, bloquear = false) {
    if (!token || token.length > 100) throw this.invalido();
    const [t] = await (em ?? this.ds).query(
      `SELECT t.id, t.tipo, t.usuario_id, u.email, u.nombre_completo AS nombre, u.activo
         FROM tokens_usuario t JOIN usuarios u ON u.id = t.usuario_id
        WHERE t.token_hash = $1 AND t.usado_en IS NULL AND t.expira_en > NOW()
        ${bloquear ? 'FOR UPDATE OF t' : ''}`,
      [hash(token)],
    );
    if (!t || !t.activo) throw this.invalido();
    return t as { id: string; tipo: TipoEnlace; usuario_id: string; email: string; nombre: string };
  }

  private invalido() {
    return new BadRequestException('El enlace no es válido o ya venció. Pide uno nuevo.');
  }

  /** Envía sin hacer esperar al usuario (y sin que el tiempo de respuesta delate si el correo existe). */
  enviarEnSegundoPlano(fn: () => Promise<void>) {
    fn().catch((e) => this.log.error(`No se pudo enviar el correo de acceso: ${(e as Error).message}`));
  }
}
