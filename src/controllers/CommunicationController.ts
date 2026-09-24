import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { EmailService } from '../services/EmailService';

const prisma = new PrismaClient();
const emailService = new EmailService();

export class CommunicationController {
  
  // Endpoint: POST /api/communications/bulk-invite
  static async sendBulkInvitations(req: Request, res: Response): Promise<void> {
    try {
      const { applicationIds, templateId } = req.body;
      
      const applications = await prisma.application.findMany({
        where: { id: { in: applicationIds } },
        include: { user: true, school: true }
      });

      const promises = applications.map(app => 
        emailService.sendTemplate(app.user.email, templateId, {
          schoolName: app.school.name,
          actionUrl: `https://beca.org/invite/${app.id}`
        })
      );
      
      await Promise.all(promises);
      
      await prisma.application.updateMany({
        where: { id: { in: applicationIds } },
        data: { status: 'INVITED' }
      });

      res.status(200).json({ message: `${applications.length} correos enviados y estados actualizados.` });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Error al enviar invitaciones masivas' });
    }
  }
}