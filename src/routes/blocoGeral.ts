import "dotenv/config";
import { Router } from "express";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { authenticateToken, requireLevel } from "../middleware/auth";

const router = Router();

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma  = new PrismaClient({ adapter });

/**
 * GET /geral/:trimestre
 * Retorna dados de TODAS as lojas a partir do cache do banco.
 * Não chama o ssOtica — mostra só o que já foi calculado.
 * Requer ADMIN_3 ou superior.
 */
router.get("/:trimestre", authenticateToken, requireLevel("REGIONAL"), async (req, res) => {
  const schema = z.object({
    trimestre: z.string().regex(/^\dT\d{2}$/, "Use formato: 2T26"),
  });

  const parsed = schema.safeParse({ trimestre: req.params.trimestre });
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { trimestre } = parsed.data;

  try {
    const isRegional = req.user!.type === "REGIONAL";
    const lojas = await prisma.loja.findMany({
      where:   isRegional ? { id: { in: req.user!.lojaIds } } : undefined,
      orderBy: { name: "asc" },
      include: {
        metasFinanceiras:  { where: { trimestre } },
        metasOperacionais: { where: { trimestre } },
      },
    });

    const resultado = lojas.map((loja) => {
      const fin = loja.metasFinanceiras[0]  ?? null;
      const op  = loja.metasOperacionais[0] ?? null;

      return {
        id:     loja.id,
        name:   loja.name,
        cnpj:   loja.cnpj,
        cidade: loja.cidade,

        financeiro: fin ? {
          calculadoEm:    fin.lastCalculatedAt,
          totalVendas:    fin.totalVendas,
          valorTotal:     fin.valorTotal ? Number(fin.valorTotal) : null,
          cartaoPct:      { atual: fin.cartaoAtual,       meta: fin.cartaoMeta },
          avistaPct:      { atual: fin.avistaAtual,       meta: fin.avistaMeta },
          ticketMedio:    { atual: fin.ticketAtual ? Number(fin.ticketAtual) : null, meta: Number(fin.ticketMeta) },
          inadimplencia:  { atual: fin.inadimplenciaAtual, meta: fin.inadimplenciaMeta },
        } : null,

        operacional: op ? {
          calculadoEm:              op.lastCalculatedAt,
          garantiasCancelamentos:   { atual: op.garantiasAtual, meta: op.garantiasMeta },
          luzter:                   { atual: op.luzterAtual,    meta: op.luzterMeta    },
          binni:                    { atual: op.binniAtual,     meta: op.binniMeta     },
        } : null,
      };
    });

    return res.json({ trimestre, total: resultado.length, lojas: resultado });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
