import { Global, Module } from '@nestjs/common';
import { AuditoriaService } from './auditoria.service';
import { ProcesoActualService } from './proceso-actual.service';
import { ArchivosService } from './archivos.service';
import { LogoFirmaService } from './logo-firma.service';

@Global()
@Module({
  providers: [AuditoriaService, ProcesoActualService, ArchivosService, LogoFirmaService],
  exports: [AuditoriaService, ProcesoActualService, ArchivosService, LogoFirmaService],
})
export class CommonModule {}
