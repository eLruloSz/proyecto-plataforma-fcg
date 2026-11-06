import { readFileSync } from 'fs';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { CommonModule } from './common/common.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { ProcesosModule } from './procesos/procesos.module';
import { LiceosModule } from './liceos/liceos.module';
import { HitosModule } from './hitos/hitos.module';
import { NominasModule } from './nominas/nominas.module';
import { InvitadosModule } from './invitados/invitados.module';
import { ComunicacionModule } from './comunicacion/comunicacion.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { AvanceModule } from './avance/avance.module';
import { PreseleccionModule } from './preseleccion/preseleccion.module';
import { EntrevistasModule } from './entrevistas/entrevistas.module';
import { GeneracionesModule } from './generaciones/generaciones.module';

/**
 * TLS hacia PostgreSQL. Se valida siempre el certificado del servidor
 * (rejectUnauthorized: true) para evitar ataques de intermediario.
 * Si el proveedor usa una CA propia (ej. Supabase), se indica la ruta del
 * certificado en DATABASE_SSL_CA.
 */
function opcionesSsl(cfg: ConfigService) {
  if (cfg.get('DATABASE_SSL') !== 'true') return false;
  const caPath = cfg.get<string>('DATABASE_SSL_CA');
  return { rejectUnauthorized: true, ...(caPath ? { ca: readFileSync(caPath, 'utf8') } : {}) };
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        type: 'postgres',
        url: cfg.getOrThrow<string>('DATABASE_URL'),
        ssl: opcionesSsl(cfg),
        synchronize: false,
        entities: [],
      }),
    }),
    CommonModule,
    AuthModule,
    ProcesosModule,
    LiceosModule,
    HitosModule,
    NominasModule,
    InvitadosModule,
    ComunicacionModule,
    DashboardModule,
    AvanceModule,
    PreseleccionModule,
    EntrevistasModule,
    GeneracionesModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}