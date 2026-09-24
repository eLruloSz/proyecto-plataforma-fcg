-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'LIAISON', 'STUDENT');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('PRESELECTED', 'INVITED', 'FORM_SUBMITTED', 'WORKSHOP_DONE', 'RANKED', 'INTERVIEW_PHASE', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SchoolType" AS ENUM ('PUBLIC', 'SUBVENCIONADO');

-- CreateEnum
CREATE TYPE "EducationLevel" AS ENUM ('SIN_ESTUDIOS', 'BASICA_INCOMPLETA', 'BASICA_COMPLETA', 'MEDIA_INCOMPLETA', 'MEDIA_COMPLETA', 'SUPERIOR_TECNICA', 'SUPERIOR_UNIVERSITARIA', 'POSTGRADO');

-- CreateTable
CREATE TABLE "Cohort" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "rankingConfig" JSONB NOT NULL,

    CONSTRAINT "Cohort_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "role" "Role" NOT NULL DEFAULT 'STUDENT',
    "schoolId" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "School" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "SchoolType" NOT NULL,

    CONSTRAINT "School_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Application" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "cohortId" TEXT NOT NULL,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'PRESELECTED',
    "grade1" DOUBLE PRECISION NOT NULL,
    "grade2" DOUBLE PRECISION NOT NULL,
    "rshPercentage" INTEGER,
    "fatherEducation" "EducationLevel",
    "motherEducation" "EducationLevel",
    "activities" JSONB,
    "rankingTotal" DOUBLE PRECISION,
    "rankingDetails" JSONB,
    "rankingWarnings" TEXT[],
    "rankingPosition" INTEGER,
    "workshopId" TEXT,
    "interviewId" TEXT,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "type" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Cohort_year_key" ON "Cohort"("year");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Application_userId_key" ON "Application"("userId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_cohortId_fkey" FOREIGN KEY ("cohortId") REFERENCES "Cohort"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_workshopId_fkey" FOREIGN KEY ("workshopId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;
