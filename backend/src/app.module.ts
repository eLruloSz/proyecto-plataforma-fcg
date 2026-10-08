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

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        type: 'postgres',
        url: cfg.getOrThrow<string>('DATABASE_URL'),
        ssl: cfg.get('DATABASE_SSL') === 'true' ? { rejectUnauthorized: false } : false,
        // El esquema vive en db/01_schema.sql (una sola fuente de verdad).
        // TypeORM se usa para la conexión y las transacciones; las consultas
        // son SQL parametrizado.
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
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
