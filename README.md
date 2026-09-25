#  Plataforma Beca Carmen Goudie (FCG)

Sistema web full-stack desarrollado para gestionar el proceso de postulación, validación de requisitos (como el Registro Social de Hogares - RSH), asignación de talleres y cálculo de rankings para la Beca Carmen Goudie.


---


##  Stack Tecnológico

* **Backend:** Node.js, Express, TypeScript, Prisma ORM.
* **Base de Datos:** PostgreSQL (alojado en Supabase).
* **Frontend:** React, Vite, Tailwind CSS (opcional/estilos), React Hook Form.


---


##  Requisitos Previos

Asegúrate de tener instalado en tu computador:

* [Node.js](https://nodejs.org/) (Versión 18 o superior recomendada).
* Git.


---


## ⚙️ Configuración del Proyecto

### 1. Clonar el repositorio e instalar dependencias del Backend
Abre tu terminal en la carpeta principal del proyecto e instala las dependencias del servidor:

```bash
npm install


DATABASE_URL="tu_cadena_de_conexion_de_supabase"
PORT=3000



3. Sincronización del cliente de Prisma
Genera los artefactos de Prisma para que la aplicación reconozca correctamente los modelos definidos en la base de datos:

npx prisma generate



Para que la plataforma opere correctamente, el sistema requiere mantener abiertos dos procesos en paralelo utilizando dos terminales independientes:

En la Primera Terminal (Backend): Inicia el servidor local de Express con TypeScript escribiendo:npx ts-node src/index.ts

En la Segunda Terminal (Frontend): Abre una ventana o pestaña nueva de la terminal, entra a la carpeta del cliente web, instala sus dependencias y arranca el entorno visual con:cd client
npm install
npm run dev

(La terminal entregará una dirección web local, por lo general http://localhost:5173, la cual debes abrir en tu navegador para interactuar con la interfaz de postulación).

Endpoints Principales del Backend
POST /api/applications/:id/submit-form: Procesa la postulación del estudiante, valida el porcentaje de RSH, actualiza los datos de contacto, asocia el taller elegido y emite la confirmación por correo.

POST /api/applications/sync-ranking: Sincroniza y calcula los puntajes de los rankings de acuerdo con las directrices institucionales.
