import "dotenv/config";
import { Router } from "express";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { requireLevel } from "../middleware/auth";

const router = Router();

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

function trimestreToJanelas(trimestre: string) {
  const match = trimestre.match(/^(\d)T(\d{2})$/);
  if (!match) throw new Error("Trimestre inválido. Use formato: 2T26");

  const q = parseInt(match[1]);
  const year = 2000 + parseInt(match[2]);
  const firstMonth = (q - 1) * 3 + 1;

  return [0, 1, 2].map((i) => {
    const month = firstMonth + i;
    const inicio = `${year}-${String(month).padStart(2, "0")}-01`;
    const fim = new Date(year, month, 0).toISOString().split("T")[0];
    return { inicio, fim };
  });
}

// Cache TTL: 4 horas para trimestre em curso; trimestre encerrado nunca expira
const CACHE_TTL_MS = 4 * 60 * 60 * 1000;

function isTrimesterComplete(trimestre: string): boolean {
  const match = trimestre.match(/^(\d)T(\d{2})$/);
  if (!match) return false;
  const q = parseInt(match[1]);
  const year = 2000 + parseInt(match[2]);
  const endDate = new Date(year, q * 3, 0);
  return new Date() > endDate;
}

function isCacheFresh(record: { calculationStatus: string; lastCalculatedAt: Date | null } | null, trimestre: string): boolean {
  if (!record || record.calculationStatus !== "success" || !record.lastCalculatedAt) return false;
  if (isTrimesterComplete(trimestre)) return true;
  return Date.now() - record.lastCalculatedAt.getTime() < CACHE_TTL_MS;
}

function getMesRefInadimplencia(): { inicio: string; fim: string } {
  const hoje = new Date();
  const ref = new Date(hoje.getFullYear(), hoje.getMonth() - 3, 1);
  const inicio = `${ref.getFullYear()}-${String(ref.getMonth() + 1).padStart(2, "0")}-01`;
  const fim = new Date(ref.getFullYear(), ref.getMonth() + 1, 0).toISOString().split("T")[0];
  return { inicio, fim };
}

async function fetchExtrato(cnpj: string, inicio: string, fim: string) {
  const url = `${process.env.SSOTICA_BASE_URL}/api/v1/integracoes/financeiro/extrato/periodo?cnpj=${cnpj}&inicio_periodo=${inicio}&fim_periodo=${fim}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.SSOTICA_TOKEN}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ssOtica extrato ${res.status}: ${inicio} → ${fim} | ${body}`);
  }
  return res.json() as Promise<any[]>;
}

async function fetchVendas(cnpj: string, inicio: string, fim: string): Promise<any[]> {
  const url = `${process.env.SSOTICA_BASE_URL}/api/v1/integracoes/vendas/periodo?cnpj=${cnpj}&inicio_periodo=${inicio}&fim_periodo=${fim}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.SSOTICA_TOKEN}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ssOtica vendas ${res.status}: ${inicio} → ${fim} | ${body}`);
  }
  return res.json() as Promise<any[]>;
}

async function fetchContasReceber(codigoLicenca: string, inicio: string, fim: string): Promise<any[]> {
  const base = `${process.env.SSOTICA_BASE_URL}/api/v1/integracoes/financeiro/contas-a-receber/periodo`;
  const todos: any[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    const url = `${base}?empresa=${codigoLicenca}&inicio_periodo=${inicio}&fim_periodo=${fim}&tipo_periodo=vencimento&perPage=100&page=${page}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${process.env.SSOTICA_TOKEN}` },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`ssOtica contas-a-receber ${res.status}: ${body}`);
    }
    const json = await res.json() as any;
    totalPages = json.totalPages ?? 1;
    todos.push(...(json.data ?? []));
    page++;
  } while (page <= totalPages);

  return todos;
}

async function calcularKRsFinanceiros(cnpj: string, trimestre: string) {
  const janelas = trimestreToJanelas(trimestre);
  const inicioTrimestre = janelas[0].inicio;
  const fimTrimestre    = janelas[2].fim;

  // Busca extrato (forma de pagamento) e vendas (valor líquido) em paralelo
  const [extratosPorJanela, vendasPorJanela] = await Promise.all([
    Promise.all(janelas.map((j) => fetchExtrato(cnpj, j.inicio, j.fim))),
    Promise.all(janelas.map((j) => fetchVendas(cnpj, j.inicio, j.fim))),
  ]);

  // ── Extrato: formas de pagamento ─────────────────────────────────────────────
  const registros = extratosPorJanela.flat().filter(
    (r) =>
      r.tipo === "CREDITO" &&
      r.categoria?.descricao === "Vendas" &&
      r.data_operacao >= inicioTrimestre &&
      r.data_operacao <= fimTrimestre
  );

  const totalExtrato = registros.reduce((acc, r) => acc + (r.valor ?? 0), 0);
  // Cartão = somente crédito; débito entra em à vista (junto com dinheiro/PIX)
  const valorCartao  = registros
    .filter((r) => /cr[eé]dito/i.test(r.forma_recebimento?.tipo ?? ""))
    .reduce((acc, r) => acc + (r.valor ?? 0), 0);
  const valorAvista  = registros
    .filter((r) => /dinheiro|pix|d[eé]bito|outros/i.test(r.forma_recebimento?.tipo ?? ""))
    .reduce((acc, r) => acc + (r.valor ?? 0), 0);

  // ── Vendas: total líquido, ticket médio e faturamento recebido no período ─────
  // valor_liquido está no nível da venda; formas_pagamento[].valor é string
  const todasVendas  = vendasPorJanela.flat();
  const qtdVendas    = todasVendas.length;

  // Base para % de pagamento e ticket (Total Líquido = valor total das vendas)
  const totalLiquido = todasVendas.reduce((acc, v) => acc + (v.valor_liquido ?? 0), 0);

  // Adiantamentos recebidos fora do período: pagamentos com data < início do trimestre
  // Esses valores foram recebidos antes do período → não compõem o faturamento do período
  const adiantamentosFora = todasVendas.reduce((acc, v) => {
    const fora = (v.formas_pagamento ?? [])
      .filter((p: any) => p.data < inicioTrimestre)
      .reduce((s: number, p: any) => s + parseFloat(String(p.valor ?? 0)), 0);
    return acc + fora;
  }, 0);

  // Faturamento do período = Total Líquido − Adiantamentos fora do período
  // (igual ao "Total recebido no período" do ssOtica)
  const valorTotalPeriodo = totalLiquido - adiantamentosFora;

  // Denominador das % = totalLiquido (inclui crediário; confirmado pelo analista)
  // Ticket médio = totalLiquido / qtd (igual ao ssOtica)
  return {
    inicioTrimestre,
    fimTrimestre,
    cartaoPct:   totalLiquido > 0 ? +((valorCartao / totalLiquido) * 100).toFixed(2) : 0,
    avistaPct:   totalLiquido > 0 ? +((valorAvista / totalLiquido) * 100).toFixed(2) : 0,
    ticketMedio: qtdVendas > 0 ? +(totalLiquido / qtdVendas).toFixed(2) : 0,
    totalVendas: qtdVendas,
    valorTotal:  +valorTotalPeriodo.toFixed(2),
  };
}

async function calcularInadimplencia(codigoLicenca: string): Promise<number | null> {
  const { inicio, fim } = getMesRefInadimplencia();
  const parcelas = await fetchContasReceber(codigoLicenca, inicio, fim);

  // Excluir convênios, exceto "Não Negativar"
  const filtradas = parcelas.filter((p) => {
    const fp = (p.forma_pagamento ?? "").toLowerCase();
    const isConvenio = /conv[eê]nio/i.test(fp);
    const isNaoNegativar = /n[aã]o\s*negativar/i.test(fp);
    return !isConvenio || isNaoNegativar;
  });

  // Exclui canceladas do denominador
  const ativas = filtradas.filter((p) => !/cancelado/i.test(p.situacao ?? ""));
  const denominador = ativas.reduce((acc, p) => acc + (p.valor_original ?? 0), 0);
  if (denominador === 0) return null;

  const numerador = ativas
    .filter((p) => /em\s*atraso/i.test(p.situacao ?? ""))
    .reduce((acc, p) => acc + (p.valor_original ?? 0), 0);

  return +((numerador / denominador) * 100).toFixed(2);
}

/**
 * GET /consulta/explorar/:trimestre?cnpj=...
 * Retorna a estrutura bruta de 1 venda da API para inspecionar campos disponíveis.
 * Nunca usa cache. Útil para diagnóstico.
 */
router.get("/explorar/:trimestre", async (req, res) => {
  const schema = z.object({
    cnpj:      z.string().min(14).max(18),
    trimestre: z.string().regex(/^\dT\d{2}$/),
  });
  const parsed = schema.safeParse({ cnpj: req.query.cnpj, trimestre: req.params.trimestre });
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { cnpj, trimestre } = parsed.data;

  try {
    const janelas = trimestreToJanelas(trimestre);
    // Pega só o 1º mês para ser rápido
    const vendas = await fetchVendas(cnpj, janelas[0].inicio, janelas[0].fim);

    if (!vendas.length) return res.json({ total: 0, amostra: null });

    // Mostra campos do objeto venda (sem os itens completos para não encher)
    const amostra = vendas.slice(0, 3).map((v) => {
      const { itens, ...resto } = v;
      return {
        ...resto,
        itens_qtd: (itens ?? []).length,
        item_amostra: (itens ?? [])[0] ?? null,
      };
    });

    // Campos disponíveis no nível da venda
    const camposVenda  = Object.keys(vendas[0]).filter(k => k !== 'itens');
    const camposItem   = Object.keys((vendas[0]?.itens ?? [])[0] ?? {});

    return res.json({
      total:        vendas.length,
      camposVenda,
      camposItem,
      amostra,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /consulta/:trimestre?cnpj=...
// DB-first: retorna do cache se disponível e fresco.
// Recalcula via ssOtica apenas quando necessário.
// Nota: só salva no banco se já existe registro (metas definidas via POST).
router.get("/:trimestre", async (req, res) => {
  const schema = z.object({
    cnpj: z.string().min(14).max(18),
    trimestre: z.string().regex(/^\dT\d{2}$/, "Use formato: 2T26"),
  });

  const parsed = schema.safeParse({ cnpj: req.query.cnpj, trimestre: req.params.trimestre });
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { cnpj, trimestre } = parsed.data;

  try {
    const loja = await prisma.loja.findUnique({ where: { cnpj } });
    if (!loja) return res.status(404).json({ error: `Loja com CNPJ ${cnpj} não encontrada.` });

    const janelas = trimestreToJanelas(trimestre);
    const lojaOut = { id: loja.id, name: loja.name, cidade: loja.cidade };
    const periodoOut = { inicio: janelas[0].inicio, fim: janelas[2].fim };

    // ── Verifica cache ───────────────────────────────────────────────────────
    const cached = await prisma.metaFinanceira.findUnique({
      where: { lojaId_trimestre: { lojaId: loja.id, trimestre } },
    });

    const force = req.query.force === 'true';
    if (!force && isCacheFresh(cached, trimestre)) {
      return res.json({
        cnpj, trimestre,
        loja: lojaOut,
        periodo: periodoOut,
        fonte: "cache",
        financeiro: {
          cartaoPct:     { atual: cached!.cartaoAtual,                          meta: cached!.cartaoMeta },
          avistaPct:     { atual: cached!.avistaAtual,                          meta: cached!.avistaMeta },
          ticketMedio:   { atual: cached!.ticketAtual ? Number(cached!.ticketAtual) : null, meta: Number(cached!.ticketMeta) },
          inadimplencia: { atual: cached!.inadimplenciaAtual,                   meta: cached!.inadimplenciaMeta },
          totalVendas:   cached!.totalVendas ?? 0,
          valorTotal:    cached!.valorTotal  ? Number(cached!.valorTotal) : 0,
        },
        operacional: null,
      });
    }

    // ── Cache miss / stale → busca na API ────────────────────────────────────
    const [kr, inadimplenciaAtual] = await Promise.all([
      calcularKRsFinanceiros(cnpj, trimestre),
      loja.codigoLicenca ? calcularInadimplencia(loja.codigoLicenca) : Promise.resolve(null),
    ]);

    // Para o create, herda as metas do trimestre mais recente já configurado para esta loja.
    // Assim quem configura metas uma vez não precisa reconfigurar para cada trimestre histórico.
    const metasHerdadas = await prisma.metaFinanceira.findFirst({
      where:   { lojaId: loja.id },
      orderBy: { trimestre: 'desc' },
      select:  { cartaoMeta: true, avistaMeta: true, ticketMeta: true, inadimplenciaMeta: true },
    });

    const saved = await prisma.metaFinanceira.upsert({
      where:  { lojaId_trimestre: { lojaId: loja.id, trimestre } },
      update: {
        cartaoAtual:       kr.cartaoPct,
        avistaAtual:       kr.avistaPct,
        ticketAtual:       kr.ticketMedio,
        inadimplenciaAtual,
        totalVendas:       kr.totalVendas,
        valorTotal:        kr.valorTotal,
        lastCalculatedAt:  new Date(),
        calculationStatus: "success",
        errorMessage:      null,
      },
      create: {
        lojaId:            loja.id,
        trimestre,
        cartaoMeta:        metasHerdadas?.cartaoMeta        ?? 50,
        avistaMeta:        metasHerdadas?.avistaMeta        ?? 30,
        ticketMeta:        metasHerdadas?.ticketMeta        ?? 600,
        inadimplenciaMeta: metasHerdadas?.inadimplenciaMeta ?? 5,
        cartaoAtual:       kr.cartaoPct,
        avistaAtual:       kr.avistaPct,
        ticketAtual:       kr.ticketMedio,
        inadimplenciaAtual,
        totalVendas:       kr.totalVendas,
        valorTotal:        kr.valorTotal,
        lastCalculatedAt:  new Date(),
        calculationStatus: "success",
      },
    });

    return res.json({
      cnpj, trimestre,
      loja: lojaOut,
      periodo: { inicio: kr.inicioTrimestre, fim: kr.fimTrimestre },
      fonte: "api",
      financeiro: {
        cartaoPct:     { atual: kr.cartaoPct,      meta: saved.cartaoMeta        ?? null },
        avistaPct:     { atual: kr.avistaPct,       meta: saved.avistaMeta        ?? null },
        ticketMedio:   { atual: kr.ticketMedio,     meta: saved.ticketMeta        ? Number(saved.ticketMeta) : null },
        inadimplencia: { atual: inadimplenciaAtual, meta: saved.inadimplenciaMeta ?? null },
        totalVendas:   kr.totalVendas,
        valorTotal:    kr.valorTotal,
      },
      operacional: null,
    });
  } catch (err: any) {
    console.error(`[GET /consulta] ${cnpj} ${trimestre} →`, err.message);
    return res.status(500).json({ error: err.message });
  }
});

// PATCH /consulta/:trimestre?cnpj=...  (exige ADMIN_2+)
// Atualiza apenas os valores de meta no banco, sem recalcular via ssOtica.
// Se o registro ainda não existe, cria com status "pending" (será calculado no próximo GET).
router.patch("/:trimestre", requireLevel("ADMIN_2"), async (req, res) => {
  const paramsSchema = z.object({
    cnpj:      z.string().min(14).max(18),
    trimestre: z.string().regex(/^\dT\d{2}$/, "Use formato: 2T26"),
  });
  const bodySchema = z.object({
    cartaoMeta:        z.number(),
    avistaMeta:        z.number(),
    ticketMeta:        z.number(),
    inadimplenciaMeta: z.number(),
  });

  console.log(`[PATCH /consulta] user=${req.user?.email} | query=`, req.query, `| body=`, req.body);

  const params = paramsSchema.safeParse({ cnpj: req.query.cnpj, trimestre: req.params.trimestre });
  if (!params.success) {
    console.log(`[PATCH /consulta] params inválidos:`, params.error.flatten());
    return res.status(400).json({ error: params.error.flatten() });
  }

  const body = bodySchema.safeParse(req.body);
  if (!body.success) {
    console.log(`[PATCH /consulta] body inválido:`, body.error.flatten());
    return res.status(400).json({ error: body.error.flatten() });
  }

  const { cnpj, trimestre } = params.data;
  const { cartaoMeta, avistaMeta, ticketMeta, inadimplenciaMeta } = body.data;

  try {
    const loja = await prisma.loja.findUnique({ where: { cnpj } });
    if (!loja) {
      console.log(`[PATCH /consulta] loja não encontrada: ${cnpj}`);
      return res.status(404).json({ error: `Loja com CNPJ ${cnpj} não encontrada.` });
    }

    console.log(`[PATCH /consulta] upsert → lojaId=${loja.id} trimestre=${trimestre} metas=`, { cartaoMeta, avistaMeta, ticketMeta, inadimplenciaMeta });

    const meta = await prisma.metaFinanceira.upsert({
      where:  { lojaId_trimestre: { lojaId: loja.id, trimestre } },
      update: { cartaoMeta, avistaMeta, ticketMeta, inadimplenciaMeta },
      create: {
        lojaId: loja.id,
        trimestre,
        cartaoMeta,
        avistaMeta,
        ticketMeta,
        inadimplenciaMeta,
        calculationStatus: "pending",
      },
    });

    console.log(`[PATCH /consulta] ✓ salvo id=${meta.id}`);
    return res.json({ id: meta.id, lojaId: loja.id, trimestre, cartaoMeta, avistaMeta, ticketMeta, inadimplenciaMeta });
  } catch (err: any) {
    console.error(`[PATCH /consulta] ERRO:`, err.message);
    return res.status(500).json({ error: err.message });
  }
});

// POST /consulta/:trimestre?cnpj=...  (exige ADMIN_2+)
router.post("/:trimestre", requireLevel("ADMIN_2"), async (req, res) => {
  const paramsSchema = z.object({
    cnpj: z.string().min(14).max(18),
    trimestre: z.string().regex(/^\dT\d{2}$/, "Use formato: 2T26"),
  });

  const bodySchema = z.object({
    cartaoMeta: z.number(),
    avistaMeta: z.number(),
    ticketMeta: z.number(),
    inadimplenciaMeta: z.number(),
  });

  const params = paramsSchema.safeParse({ cnpj: req.query.cnpj, trimestre: req.params.trimestre });
  if (!params.success) return res.status(400).json({ error: params.error.flatten() });

  const body = bodySchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: body.error.flatten() });

  const { cnpj, trimestre } = params.data;
  const { cartaoMeta, avistaMeta, ticketMeta, inadimplenciaMeta } = body.data;

  try {
    const loja = await prisma.loja.findUnique({ where: { cnpj } });
    if (!loja) return res.status(404).json({ error: `Loja com CNPJ ${cnpj} não encontrada.` });

    const [kr, inadimplenciaAtual] = await Promise.all([
      calcularKRsFinanceiros(cnpj, trimestre),
      loja.codigoLicenca ? calcularInadimplencia(loja.codigoLicenca) : Promise.resolve(null),
    ]);

    const meta = await prisma.metaFinanceira.upsert({
      where: { lojaId_trimestre: { lojaId: loja.id, trimestre } },
      update: {
        cartaoAtual: kr.cartaoPct, avistaAtual: kr.avistaPct,
        ticketAtual: kr.ticketMedio, inadimplenciaAtual,
        totalVendas: kr.totalVendas, valorTotal: kr.valorTotal,
        cartaoMeta, avistaMeta, ticketMeta, inadimplenciaMeta,
        lastCalculatedAt: new Date(), calculationStatus: "success", errorMessage: null,
      },
      create: {
        lojaId: loja.id, trimestre,
        cartaoAtual: kr.cartaoPct, avistaAtual: kr.avistaPct,
        ticketAtual: kr.ticketMedio, inadimplenciaAtual,
        totalVendas: kr.totalVendas, valorTotal: kr.valorTotal,
        cartaoMeta, avistaMeta, ticketMeta, inadimplenciaMeta,
        lastCalculatedAt: new Date(), calculationStatus: "success",
      },
    });

    return res.status(201).json({ id: meta.id, lojaId: loja.id, trimestre, financeiro: {
      cartaoAtual: kr.cartaoPct, cartaoMeta,
      avistaAtual: kr.avistaPct, avistaMeta,
      ticketAtual: kr.ticketMedio, ticketMeta,
      inadimplenciaAtual, inadimplenciaMeta,
    }});
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /consulta/batch/:trimestre  (exige ADMIN_2+)
router.post("/batch/:trimestre", requireLevel("ADMIN_2"), async (req, res) => {
  const trimestreSchema = z.string().regex(/^\dT\d{2}$/, "Use formato: 2T26");
  const bodySchema = z.object({
    cartaoMeta: z.number(),
    avistaMeta: z.number(),
    ticketMeta: z.number(),
    inadimplenciaMeta: z.number(),
  });

  const trimestreParsed = trimestreSchema.safeParse(req.params.trimestre);
  if (!trimestreParsed.success) return res.status(400).json({ error: "Trimestre inválido. Use formato: 2T26" });

  const body = bodySchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: body.error.flatten() });

  const trimestre = trimestreParsed.data;
  const { cartaoMeta, avistaMeta, ticketMeta, inadimplenciaMeta } = body.data;

  const lojas = await prisma.loja.findMany();
  if (!lojas.length) return res.status(404).json({ error: "Nenhuma loja cadastrada." });

  const resultados = await Promise.all(
    lojas.map(async (loja) => {
      try {
        const [kr, inadimplenciaAtual] = await Promise.all([
          calcularKRsFinanceiros(loja.cnpj, trimestre),
          loja.codigoLicenca ? calcularInadimplencia(loja.codigoLicenca) : Promise.resolve(null),
        ]);

        await prisma.metaFinanceira.upsert({
          where: { lojaId_trimestre: { lojaId: loja.id, trimestre } },
          update: {
            cartaoAtual: kr.cartaoPct, avistaAtual: kr.avistaPct,
            ticketAtual: kr.ticketMedio, inadimplenciaAtual,
            totalVendas: kr.totalVendas, valorTotal: kr.valorTotal,
            cartaoMeta, avistaMeta, ticketMeta, inadimplenciaMeta,
            lastCalculatedAt: new Date(), calculationStatus: "success", errorMessage: null,
          },
          create: {
            lojaId: loja.id, trimestre,
            cartaoAtual: kr.cartaoPct, avistaAtual: kr.avistaPct,
            ticketAtual: kr.ticketMedio, inadimplenciaAtual,
            totalVendas: kr.totalVendas, valorTotal: kr.valorTotal,
            cartaoMeta, avistaMeta, ticketMeta, inadimplenciaMeta,
            lastCalculatedAt: new Date(), calculationStatus: "success",
          },
        });

        return {
          cnpj: loja.cnpj, name: loja.name, status: "success",
          financeiro: {
            cartaoAtual: kr.cartaoPct, cartaoMeta,
            avistaAtual: kr.avistaPct, avistaMeta,
            ticketAtual: kr.ticketMedio, ticketMeta,
            inadimplenciaAtual, inadimplenciaMeta,
            totalVendas: kr.totalVendas, valorTotal: kr.valorTotal,
          },
        };
      } catch (err: any) {
        return { cnpj: loja.cnpj, name: loja.name, status: "error", error: err.message };
      }
    })
  );

  const total = resultados.length;
  const sucesso = resultados.filter((r) => r.status === "success").length;
  const falha = total - sucesso;

  return res.status(200).json({ trimestre, total, sucesso, falha, resultados });
});

export default router;
