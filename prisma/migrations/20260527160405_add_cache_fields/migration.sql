-- AlterTable
ALTER TABLE "HistoricoMetaFinanceira" ADD COLUMN     "totalVendas" INTEGER,
ADD COLUMN     "valorTotal" DECIMAL(14,2);

-- AlterTable
ALTER TABLE "HistoricoMetaOperacional" ADD COLUMN     "binniOutrasPct" DOUBLE PRECISION,
ADD COLUMN     "binniOutrasValor" DOUBLE PRECISION,
ADD COLUMN     "detalhesBinni" JSONB,
ADD COLUMN     "detalhesLuzter" JSONB,
ADD COLUMN     "garantiasQtd" INTEGER,
ADD COLUMN     "garantiasTotal" INTEGER,
ADD COLUMN     "luzterOutrasPct" DOUBLE PRECISION,
ADD COLUMN     "luzterOutrasValor" DOUBLE PRECISION,
ADD COLUMN     "valorBinni" DOUBLE PRECISION,
ADD COLUMN     "valorLuzter" DOUBLE PRECISION,
ADD COLUMN     "valorTotalArmacoes" DOUBLE PRECISION,
ADD COLUMN     "valorTotalLentes" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "MetaFinanceira" ADD COLUMN     "totalVendas" INTEGER,
ADD COLUMN     "valorTotal" DECIMAL(14,2);

-- AlterTable
ALTER TABLE "MetaOperacional" ADD COLUMN     "binniOutrasPct" DOUBLE PRECISION,
ADD COLUMN     "binniOutrasValor" DOUBLE PRECISION,
ADD COLUMN     "detalhesBinni" JSONB,
ADD COLUMN     "detalhesLuzter" JSONB,
ADD COLUMN     "garantiasQtd" INTEGER,
ADD COLUMN     "garantiasTotal" INTEGER,
ADD COLUMN     "luzterOutrasPct" DOUBLE PRECISION,
ADD COLUMN     "luzterOutrasValor" DOUBLE PRECISION,
ADD COLUMN     "valorBinni" DOUBLE PRECISION,
ADD COLUMN     "valorLuzter" DOUBLE PRECISION,
ADD COLUMN     "valorTotalArmacoes" DOUBLE PRECISION,
ADD COLUMN     "valorTotalLentes" DOUBLE PRECISION,
ALTER COLUMN "garantiasMeta" SET DEFAULT 5,
ALTER COLUMN "luzterMeta" SET DEFAULT 85,
ALTER COLUMN "binniMeta" SET DEFAULT 35;
