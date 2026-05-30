-- Renomeia os valores do enum UserType preservando todos os dados existentes
-- PostgreSQL 10+ suporta ALTER TYPE ... RENAME VALUE nativamente

ALTER TYPE "UserType" RENAME VALUE 'USER'     TO 'LOJA';
ALTER TYPE "UserType" RENAME VALUE 'REGIONAL' TO 'GERENTE';
ALTER TYPE "UserType" RENAME VALUE 'ADMIN_3'  TO 'DIRECAO';
ALTER TYPE "UserType" RENAME VALUE 'ADMIN_2'  TO 'ADMINISTRATIVO';
ALTER TYPE "UserType" RENAME VALUE 'ADMIN_1'  TO 'TI';
