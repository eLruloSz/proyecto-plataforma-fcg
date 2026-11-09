import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { Response } from 'express';

@Injectable()
export class ExcelService {
  
  // Exportación estándar por etapa
  async exportarDatosEtapa(datos: any[], res: Response, nombreArchivo: string) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Datos');

    // 1. Identificar columnas que tienen al menos un valor no nulo/vacío
    const clavesValidas = new Set<string>();
    datos.forEach(estudiante => {
      Object.keys(estudiante).forEach(key => {
        if (estudiante[key] !== null && estudiante[key] !== undefined && estudiante[key] !== '') {
          clavesValidas.add(key);
        }
      });
    });

    // 2. Configurar las columnas dinámicas en la hoja
    worksheet.columns = Array.from(clavesValidas).map(clave => ({
      header: clave.toUpperCase().replace(/_/g, ' '), // Formatear cabeceras
      key: clave,
      width: 20
    }));

    // 3. Añadir la data y enviar al cliente
    worksheet.addRows(datos);
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=${nombreArchivo}.xlsx`);
    
    await workbook.xlsx.write(res);
    res.end();
  }

  // Exportación especial con formato de múltiples hojas
  async exportarListadoFinal(datosCompletos: any, res: Response) {
    const workbook = new ExcelJS.Workbook();
    
    // Crear las hojas solicitadas
    const sheetInvitados = workbook.addWorksheet('Invitados');
    const sheetCorreos = workbook.addWorksheet('Correos postulantes');
    const sheetEnvios = workbook.addWorksheet('Envíos Formulario con RSH');
    const sheetLiceo = workbook.addWorksheet('Postulantes por liceo');

    // Aquí mapeas la data específica a cada hoja usando la misma lógica de omitir vacíos o columnas estáticas
    // sheetInvitados.columns = [ ... ];
    // sheetInvitados.addRows(datosCompletos.invitados);
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=Listado_Final_Invitados.xlsx');
    
    await workbook.xlsx.write(res);
    res.end();
  }
}