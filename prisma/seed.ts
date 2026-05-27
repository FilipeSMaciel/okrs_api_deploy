import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const lojas = [
  { cnpj: "04.720.838/0002-91", name: "Bilharva",    cidade: "São Lourenço do Sul", endereco: "CEL. ALFREDO BORN, 501 - CEP 96170-000",          codigoLicenca: "G24G-QRPU" },
  { cnpj: "04.720.838/0004-53", name: "Bilharva",    cidade: "Pinheiro Machado",    endereco: "DUTRA DE ANDRADE, 714 - CEP 96470-000",           codigoLicenca: "PRY4-QION" },
  { cnpj: "04.720.838/0005-34", name: "Santa Clara", cidade: "Bagé",                endereco: "SETE DE SETEMBRO, 1037 - CEP 96400-003",          codigoLicenca: "GC9S-LHHL" },
  { cnpj: "04.720.838/0007-04", name: "Veja Bem",    cidade: "Pelotas",             endereco: "MARECHAL DEODORO, 803B - CEP 96180-000",          codigoLicenca: "IVDY-MY3R" },
  { cnpj: "04.720.838/0008-87", name: "Santa Clara", cidade: "Pelotas",             endereco: "GENERAL NETO, 1151 AP01 - CEP 96020-000",         codigoLicenca: "BSTC-7XLG" },
  { cnpj: "04.720.838/0010-00", name: "Bilharva",    cidade: "Dom Pedrito",         endereco: "BORGES DE MEDEIROS, 950 - CEP 96450-000",         codigoLicenca: "7W8A-WVQE" },
  { cnpj: "04.720.838/0011-82", name: "Bilharva",    cidade: "Pelotas",             endereco: "MARECHAL FLORIANO, 171 - CEP 96015-440",          codigoLicenca: "CIZW-MYEI" },
  { cnpj: "04.720.838/0012-63", name: "Bilharva",    cidade: "Arroio Grande",       endereco: "JULIO DE CASTILHO, 415 - CEP 96330-970",          codigoLicenca: "B1ZO-9AGM" },
  { cnpj: "04.720.838/0013-44", name: "Veja Bem",    cidade: "Bagé",                endereco: "SETE DE SETEMBRO, 759 - CEP 96400-000",           codigoLicenca: "REB0-KUK5" },
  { cnpj: "04.720.838/0016-97", name: "Fênix",       cidade: "Pelotas",             endereco: "PRAÇA PIRATININO DE ALMEIDA, 12 - CEP 96015-440", codigoLicenca: "OUIL-6UCG" },
  { cnpj: "04.720.838/0015-06", name: "Bilharva",    cidade: "Candiota",            endereco: "FRANCISCO ASSIS DO PINHO, 160 - CEP 96495-000",   codigoLicenca: "Y49Q-QQQ0" },
  { cnpj: "36.524.202/0001-80", name: "Bilharva",    cidade: "Bagé",                endereco: "SETE DE SETEMBRO, 1040 - CEP 96400-003",          codigoLicenca: "QNVN-OPZE" },
  { cnpj: "93.964.575/0001-05", name: "Karisma",     cidade: "Pelotas",             endereco: "SETE DE SETEMBRO, 357 - CEP 96015-440",           codigoLicenca: "8C4F-RX3N" },
  { cnpj: "08.983.494/0001-83", name: "Bilharva",    cidade: "Jaguarão",            endereco: "JULIO DE CASTILHO, 254 - CEP 96300-000",          codigoLicenca: "VO2W-VPYQ" },
  { cnpj: "07.184.680/0001-90", name: "Skina",       cidade: "Pelotas",             endereco: "GENERAL NETO, 1151 - CEP 96020-000",              codigoLicenca: "LLLC-KQEM" },
  { cnpj: "17.640.235/0002-21", name: "Voluntários", cidade: "Pelotas",             endereco: "VOLUNTÁRIOS DA PÁTRIA, 1174 - CEP 96015-730",     codigoLicenca: "URGH-0DPP" },
];

async function main() {
  // ── Lojas ──────────────────────────────────────────────────────────────────
  for (const loja of lojas) {
    await prisma.loja.upsert({
      where:  { cnpj: loja.cnpj },
      update: { name: loja.name, cidade: loja.cidade, endereco: loja.endereco, codigoLicenca: loja.codigoLicenca },
      create: loja,
    });
  }
  console.log(`${lojas.length} lojas inseridas/atualizadas.`);

  // ── Usuário ADMIN_1 padrão ─────────────────────────────────────────────────
  const adminEmail = "admin@bilharva.com.br";
  const adminExists = await prisma.user.findUnique({ where: { email: adminEmail } });

  if (!adminExists) {
    const hashed = await bcrypt.hash("Admin@2026", 10);
    await prisma.user.create({
      data: {
        name:     "Administrador",
        email:    adminEmail,
        password: hashed,
        type:     "ADMIN_1",
      },
    });
    console.log(`Usuário ADMIN_1 criado: ${adminEmail} / Admin@2026`);
    console.log("⚠️  Altere a senha após o primeiro login!");
  } else {
    console.log(`Usuário ADMIN_1 já existe: ${adminEmail}`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
