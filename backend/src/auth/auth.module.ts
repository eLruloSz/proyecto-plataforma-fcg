import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => {
        const secret = cfg.getOrThrow<string>('JWT_SECRET');
        if (secret.length < 32) throw new Error('JWT_SECRET debe tener al menos 32 caracteres.');
        return { secret, signOptions: { expiresIn: cfg.get('JWT_EXPIRES') ?? '8h' } };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [JwtModule],
})
export class AuthModule {}
