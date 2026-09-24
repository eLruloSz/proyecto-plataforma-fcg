export class EmailService {
  async sendTemplate(to: string, templateId: string, templateData: any): Promise<void> {
    console.log(`Simulando envío de correo a ${to} con plantilla ${templateId}`);
    // Aquí después integrarás tu proveedor real (Resend, SendGrid, Nodemailer, etc.)
  }
}