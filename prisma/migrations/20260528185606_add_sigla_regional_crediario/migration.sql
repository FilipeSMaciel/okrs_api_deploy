/*
  Warnings:

  - The values [ADMIN] on the enum `UserType` will be removed. If these variants are still used in the database, this will fail.
  - A unique constraint covering the columns `[sigla]` on the table `Loja` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "UserType_new" AS ENUM ('USER', 'REGIONAL', 'ADMIN_3', 'ADMIN_2', 'ADMIN_1');
ALTER TABLE "User" ALTER COLUMN "type" TYPE "UserType_new" USING ("type"::text::"UserType_new");
ALTER TYPE "UserType" RENAME TO "UserType_old";
ALTER TYPE "UserType_new" RENAME TO "UserType";
DROP TYPE "public"."UserType_old";
COMMIT;

-- AlterTable
ALTER TABLE "HistoricoMetaFinanceira" ADD COLUMN     "crediarioMeta" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "Loja" ADD COLUMN     "sigla" TEXT;

-- AlterTable
ALTER TABLE "MetaFinanceira" ADD COLUMN     "crediarioMeta" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lojaId" TEXT;

-- CreateTable
CREATE TABLE "UserLoja" (
    "userId" TEXT NOT NULL,
    "lojaId" TEXT NOT NULL,

    CONSTRAINT "UserLoja_pkey" PRIMARY KEY ("userId","lojaId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Loja_sigla_key" ON "Loja"("sigla");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserLoja" ADD CONSTRAINT "UserLoja_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserLoja" ADD CONSTRAINT "UserLoja_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE CASCADE ON UPDATE CASCADE;
