import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma  = new PrismaClient({ adapter });

const TRIMESTRE = "2T26";

// sigla | cnpj | crediarioMeta | cartaoMeta (Crédito) | avistaMeta (À vista + débito)
const metas = [
  { sigla: "BAG",  cnpj: "04.720.838/0012-63", crediario: 50, cartao: 30, avista: 20 }, // Bilharva Arroio Grande
  { sigla: "BB",   cnpj: "36.524.202/0001-80", crediario: 40, cartao: 35, avista: 25 }, // Bilharva Bagé
  { sigla: "BC",   cnpj: "04.720.838/0015-06", crediario: 55, cartao: 20, avista: 25 }, // Bilharva Candiota
  { sigla: "BDP",  cnpj: "04.720.838/0010-00", crediario: 50, cartao: 30, avista: 20 }, // Bilharva Dom Pedrito
  { sigla: "BJG",  cnpj: "08.983.494/0001-83", crediario: 50, cartao: 25, avista: 25 }, // Bilharva Jaguarão
  { sigla: "BP",   cnpj: "04.720.838/0011-82", crediario: 50, cartao: 30, avista: 20 }, // Bilharva Pelotas
  { sigla: "BPM",  cnpj: "04.720.838/0004-53", crediario: 50, cartao: 25, avista: 25 }, // Bilharva Pinheiro Machado
  { sigla: "BSLS", cnpj: "04.720.838/0002-91", crediario: 50, cartao: 25, avista: 25 }, // Bilharva São Lourenço do Sul
  { sigla: "FNX",  cnpj: "04.720.838/0016-97", crediario: 30, cartao: 40, avista: 30 }, // Fênix
  { sigla: "KP",   cnpj: "93.964.575/0001-05", crediario: 20, cartao: 50, avista: 30 }, // Karisma
  { sigla: "SCB",  cnpj: "04.720.838/0005-34", crediario: 50, cartao: 30, avista: 20 }, // Santa Clara Bagé
  { sigla: "SCP",  cnpj: "04.720.838/0008-87", crediario: 40, cartao: 35, avista: 25 }, // Santa Clara Pelotas
  { sigla: "SK",   cnpj: "07.184.680/0001-90", crediario: 30, cartao: 45, avista: 25 }, // Skina
  { sigla: "VBB",  cnpj: "04.720.838/0013-44", crediario: 50, cartao: 30, avista: 20 }, // Veja Bem Bagé
  { sigla: "VBP",  cnpj: "04.720.838/0007-04", crediario: 35, cartao: 35, avista: 30 }, // Veja Bem Pelotas
  { sigla: "VLT",  cnpj: "17.640.235/0002-21", crediario: 35, cartao: 35, avista: 30 }, // Voluntários
];

async function main() {
  let ok = 0;
  let err = 0;

  for (const m of metas) {
    const loja = await prisma.loja.findUnique({ where: { cnpj: m.cnpj } });
    if (!loja) {
      console.error(`❌  Loja não encontrada: ${m.sigla} (${m.cnpj})`);
      err++;
      continue;
    }

    await prisma.metaFinanceira.upsert({
      where:  { lojaId_trimestre: { lojaId: loja.id, trimestre: TRIMESTRE } },
      update: {
        crediarioMeta: m.crediario,
        cartaoMeta:    m.cartao,
        avistaMeta:    m.avista,
      },
      create: {
        lojaId:            loja.id,
        trimestre:         TRIMESTRE,
        crediarioMeta:     m.crediario,
        cartaoMeta:        m.cartao,
        avistaMeta:        m.avista,
        ticketMeta:        0,
        inadimplenciaMeta: 0,
      },
    });

    console.log(`✅  ${m.sigla.padEnd(5)}  crediário=${m.crediario}%  cartão=${m.cartao}%  à vista=${m.avista}%`);
    ok++;
  }

  console.log(`\nConcluído: ${ok} atualizadas, ${err} erros.`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
