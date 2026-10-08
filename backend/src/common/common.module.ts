import { Global, Module } from '@nestjs/common';
import { AuditoriaService } from './auditoria.service';
import { ProcesoActualService } from './proceso-actual.service';
import { ArchivosService } from './archivos.service';

@Global()
@Module({
  providers: [AuditoriaService, ProcesoActualService, ArchivosService],
  exports: [AuditoriaService, ProcesoActualService, ArchivosService],
})
export class CommonModule {}
