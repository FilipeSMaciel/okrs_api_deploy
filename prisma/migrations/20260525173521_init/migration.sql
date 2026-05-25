-- CreateEnum
CREATE TYPE "UserType" AS ENUM ('ADMIN', 'USER');

-- CreateEnum
CREATE TYPE "LojaName" AS ENUM ('LOJA1', 'LOJA2', 'LOJA3', 'LOJA4', 'LOJA5');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "type" "UserType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Loja" (
    "id" TEXT NOT NULL,
    "name" "LojaName" NOT NULL,
    "cnpj" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Loja_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetaFinanceira" (
    "id" TEXT NOT NULL,
    "trimestre" VARCHAR(10) NOT NULL,
    "cartaoAtual" DOUBLE PRECISION,
    "cartaoMeta" DOUBLE PRECISION NOT NULL,
    "avistaAtual" DOUBLE PRECISION,
    "avistaMeta" DOUBLE PRECISION NOT NULL,
    "ticketAtual" DECIMAL(10,2),
    "ticketMeta" DECIMAL(10,2) NOT NULL,
    "inadimplenciaAtual" DOUBLE PRECISION,
    "inadimplenciaMeta" DOUBLE PRECISION NOT NULL,
    "lastCalculatedAt" TIMESTAMP(3),
    "calculationStatus" TEXT NOT NULL DEFAULT 'pending',
    "errorMessage" TEXT,
    "lojaId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetaFinanceira_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetaOperacional" (
    "id" TEXT NOT NULL,
    "trimestre" VARCHAR(10) NOT NULL,
    "garantiasAtual" DOUBLE PRECISION,
    "garantiasMeta" DOUBLE PRECISION NOT NULL,
    "luzterAtual" DOUBLE PRECISION,
    "luzterMeta" DOUBLE PRECISION NOT NULL,
    "binniAtual" DOUBLE PRECISION,
    "binniMeta" DOUBLE PRECISION NOT NULL,
    "lastCalculatedAt" TIMESTAMP(3),
    "calculationStatus" TEXT NOT NULL DEFAULT 'pending',
    "errorMessage" TEXT,
    "lojaId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetaOperacional_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HistoricoMetaFinanceira" (
    "id" TEXT NOT NULL,
    "trimestre" VARCHAR(10) NOT NULL,
    "cartaoAtual" DOUBLE PRECISION,
    "cartaoMeta" DOUBLE PRECISION NOT NULL,
    "avistaAtual" DOUBLE PRECISION,
    "avistaMeta" DOUBLE PRECISION NOT NULL,
    "ticketAtual" DECIMAL(10,2),
    "ticketMeta" DECIMAL(10,2) NOT NULL,
    "inadimplenciaAtual" DOUBLE PRECISION,
    "inadimplenciaMeta" DOUBLE PRECISION NOT NULL,
    "calculationStatus" TEXT NOT NULL,
    "errorMessage" TEXT,
    "lojaId" TEXT NOT NULL,
    "snapshotEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HistoricoMetaFinanceira_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HistoricoMetaOperacional" (
    "id" TEXT NOT NULL,
    "trimestre" VARCHAR(10) NOT NULL,
    "garantiasAtual" DOUBLE PRECISION,
    "garantiasMeta" DOUBLE PRECISION NOT NULL,
    "luzterAtual" DOUBLE PRECISION,
    "luzterMeta" DOUBLE PRECISION NOT NULL,
    "binniAtual" DOUBLE PRECISION,
    "binniMeta" DOUBLE PRECISION NOT NULL,
    "calculationStatus" TEXT NOT NULL,
    "errorMessage" TEXT,
    "lojaId" TEXT NOT NULL,
    "snapshotEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HistoricoMetaOperacional_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Loja_name_key" ON "Loja"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Loja_cnpj_key" ON "Loja"("cnpj");

-- CreateIndex
CREATE INDEX "MetaFinanceira_lojaId_trimestre_idx" ON "MetaFinanceira"("lojaId", "trimestre");

-- CreateIndex
CREATE UNIQUE INDEX "MetaFinanceira_lojaId_trimestre_key" ON "MetaFinanceira"("lojaId", "trimestre");

-- CreateIndex
CREATE INDEX "MetaOperacional_lojaId_trimestre_idx" ON "MetaOperacional"("lojaId", "trimestre");

-- CreateIndex
CREATE UNIQUE INDEX "MetaOperacional_lojaId_trimestre_key" ON "MetaOperacional"("lojaId", "trimestre");

-- CreateIndex
CREATE INDEX "HistoricoMetaFinanceira_lojaId_trimestre_idx" ON "HistoricoMetaFinanceira"("lojaId", "trimestre");

-- CreateIndex
CREATE INDEX "HistoricoMetaFinanceira_snapshotEm_idx" ON "HistoricoMetaFinanceira"("snapshotEm");

-- CreateIndex
CREATE INDEX "HistoricoMetaOperacional_lojaId_trimestre_idx" ON "HistoricoMetaOperacional"("lojaId", "trimestre");

-- CreateIndex
CREATE INDEX "HistoricoMetaOperacional_snapshotEm_idx" ON "HistoricoMetaOperacional"("snapshotEm");

-- AddForeignKey
ALTER TABLE "MetaFinanceira" ADD CONSTRAINT "MetaFinanceira_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetaOperacional" ADD CONSTRAINT "MetaOperacional_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoricoMetaFinanceira" ADD CONSTRAINT "HistoricoMetaFinanceira_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoricoMetaOperacional" ADD CONSTRAINT "HistoricoMetaOperacional_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE CASCADE ON UPDATE CASCADE;
