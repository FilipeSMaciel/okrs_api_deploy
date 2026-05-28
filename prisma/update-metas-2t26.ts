import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma  = new PrismaClient({ adapter });

const TRIMESTRE = "2T26";

// sigla (display) | cnpj
// Financeiras: cartao, avista (crediario = 100 - cartao - avista), ticket (R$), inadimplencia (%)
// Operacionais: garantias (%), luzter (%), binni (%)
const metas = [
  {
    sigla: "BAG",  cnpj: "04.720.838/0012-63",
    cartao: 30, avista: 20, ticket: 1300, inadimplencia: 10,
    garantias: 5, luzter: 90, binni: 35,
  },
  {
    sigla: "BB",   cnpj: "36.524.202/0001-80",
    cartao: 35, avista: 25, ticket: 1250, inadimplencia: 10,
    garantias: 5, luzter: 95, binni: 35,
  },
  {
    sigla: "BC",   cnpj: "04.720.838/0015-06",
    cartao: 20, avista: 25, ticket: 1050, inadimplencia: 10,
    garantias: 5, luzter: 95, binni: 45,
  },
  {
    sigla: "BDP",  cnpj: "04.720.838/0010-00",
    cartao: 30, avista: 20, ticket: 1050, inadimplencia: 10,
    garantias: 5, luzter: 95, binni: 45,
  },
  {
    sigla: "BJG",  cnpj: "08.983.494/0001-83",
    cartao: 25, avista: 25, ticket: 1100, inadimplencia: 10,
    garantias: 5, luzter: 95, binni: 35,
  },
  {
    sigla: "BP",   cnpj: "04.720.838/0011-82",
    cartao: 30, avista: 20, ticket: 1350, inadimplencia: 10,
    garantias: 5, luzter: 80, binni: 30,
  },
  {
    sigla: "BPM",  cnpj: "04.720.838/0004-53",
    cartao: 25, avista: 25, ticket: 1100, inadimplencia: 10,
    garantias: 5, luzter: 95, binni: 45,
  },
  {
    sigla: "BSLS", cnpj: "04.720.838/0002-91",
    cartao: 25, avista: 25, ticket: 1400, inadimplencia: 10,
    garantias: 5, luzter: 95, binni: 45,
  },
  {
    sigla: "FNX",  cnpj: "04.720.838/0016-97",
    cartao: 40, avista: 30, ticket: 1100, inadimplencia: 10,
    garantias: 5, luzter: 85, binni: 35,
  },
  {
    sigla: "KP",   cnpj: "93.964.575/0001-05",
    cartao: 50, avista: 30, ticket: 1400, inadimplencia: 10,
    garantias: 5, luzter: 75, binni: 20,
  },
  {
    sigla: "SCB",  cnpj: "04.720.838/0005-34",
    cartao: 30, avista: 20, ticket: 1300, inadimplencia: 10,
    garantias: 5, luzter: 95, binni: 40,
  },
  {
    sigla: "SCP",  cnpj: "04.720.838/0008-87",
    cartao: 35, avista: 25, ticket: 1200, inadimplencia: 10,
    garantias: 5, luzter: 90, binni: 35,
  },
  {
    sigla: "SK",   cnpj: "07.184.680/0001-90",
    cartao: 45, avista: 25, ticket: 1200, inadimplencia: 10,
    garantias: 5, luzter: 80, binni: 20,
  },
  {
    sigla: "VBB",  cnpj: "04.720.838/0013-44",
    cartao: 30, avista: 20, ticket: 1100, inadimplencia: 10,
    garantias: 5, luzter: 95, binni: 35,
  },
  {
    sigla: "VBP",  cnpj: "04.720.838/0007-04",
    cartao: 35, avista: 30, ticket: 1000, inadimplencia: 10,
    garantias: 5, luzter: 90, binni: 40,
  },
  {
    sigla: "VLT",  cnpj: "17.640.235/0002-21",
    cartao: 35, avista: 30, ticket: 800, inadimplencia: 10,
    garantias: 5, luzter: 90, binni: 50,
  },
];

async function main() {
  let ok = 0;
  let erros = 0;

  for (const m of metas) {
    const loja = await prisma.loja.findUnique({ where: { cnpj: m.cnpj } });
    if (!loja) {
      console.error(`❌  Loja não encontrada: ${m.sigla} (${m.cnpj})`);
      erros++;
      continue;
    }

    const crediario = 100 - m.cartao - m.avista;

    // ── MetaFinanceira ──────────────────────────────────────────────────────
    await prisma.metaFinanceira.upsert({
      where:  { lojaId_trimestre: { lojaId: loja.id, trimestre: TRIMESTRE } },
      update: {
        crediarioMeta:     crediario,
        cartaoMeta:        m.cartao,
        avistaMeta:        m.avista,
        ticketMeta:        m.ticket,
        inadimplenciaMeta: m.inadimplencia,
      },
      create: {
        lojaId:            loja.id,
        trimestre:         TRIMESTRE,
        crediarioMeta:     crediario,
        cartaoMeta:        m.cartao,
        avistaMeta:        m.avista,
        ticketMeta:        m.ticket,
        inadimplenciaMeta: m.inadimplencia,
      },
    });

    // ── MetaOperacional ─────────────────────────────────────────────────────
    await prisma.metaOperacional.upsert({
      where:  { lojaId_trimestre: { lojaId: loja.id, trimestre: TRIMESTRE } },
      update: {
        garantiasMeta: m.garantias,
        luzterMeta:    m.luzter,
        binniMeta:     m.binni,
      },
      create: {
        lojaId:        loja.id,
        trimestre:     TRIMESTRE,
        garantiasMeta: m.garantias,
        luzterMeta:    m.luzter,
        binniMeta:     m.binni,
        calculationStatus: "pending",
      },
    });

    console.log(
      `✅  ${m.sigla.padEnd(5)}  cartão=${m.cartao}%  à vista=${m.avista}%  crediário=${crediario}%` +
      `  ticket=R$${m.ticket}  inad=${m.inadimplencia}%` +
      `  garantias=${m.garantias}%  luzter=${m.luzter}%  binni=${m.binni}%`
    );
    ok++;
  }

  console.log(`\nConcluído: ${ok} lojas atualizadas, ${erros} erros.`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
