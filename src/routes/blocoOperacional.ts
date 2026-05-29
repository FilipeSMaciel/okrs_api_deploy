import "dotenv/config";
import { Router } from "express";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { requireLevel } from "../middleware/auth";

const router = Router();

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

// Metas padrão do bloco operacional
const META_GARANTIAS = 5;
const META_LUZTER    = 85;
const META_BINNI     = 35;

// Cache TTL: 4 horas para trimestre em curso; trimestre encerrado nunca expira
const CACHE_TTL_MS = 4 * 60 * 60 * 1000;

// ─── Helpers ────────────────────────────────────────────────────────────────

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

/** Retorna true se o trimestre já encerrou (data fim no passado). */
function isTrimesterComplete(trimestre: string): boolean {
  const match = trimestre.match(/^(\d)T(\d{2})$/);
  if (!match) return false;
  const q = parseInt(match[1]);
  const year = 2000 + parseInt(match[2]);
  const endDate = new Date(year, q * 3, 0); // último dia do último mês
  return new Date() > endDate;
}

/** Verifica se o registro do cache ainda é válido. */
function isCacheFresh(record: { calculationStatus: string; lastCalculatedAt: Date | null } | null, trimestre: string): boolean {
  if (!record || record.calculationStatus !== "success" || !record.lastCalculatedAt) return false;
  if (isTrimesterComplete(trimestre)) return true; // trimestre encerrado: não recalcular
  return Date.now() - record.lastCalculatedAt.getTime() < CACHE_TTL_MS;
}

// ─── Fetchers ────────────────────────────────────────────────────────────────

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

async function fetchOS(cnpj: string, inicio: string, fim: string): Promise<any[]> {
  const url = `${process.env.SSOTICA_BASE_URL}/api/v1/integracoes/ordens-servico/periodo?cnpj=${cnpj}&inicio_periodo=${inicio}&fim_periodo=${fim}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.SSOTICA_TOKEN}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ssOtica OS ${res.status}: ${inicio} → ${fim} | ${body}`);
  }
  return res.json() as Promise<any[]>;
}

async function fetchVendasTrimestre(cnpj: string, trimestre: string): Promise<any[]> {
  const janelas = trimestreToJanelas(trimestre);
  const resultados = await Promise.all(janelas.map((j) => fetchVendas(cnpj, j.inicio, j.fim)));
  return resultados.flat();
}

async function fetchOSTrimestre(cnpj: string, trimestre: string): Promise<any[]> {
  const janelas = trimestreToJanelas(trimestre);
  const resultados = await Promise.all(janelas.map((j) => fetchOS(cnpj, j.inicio, j.fim)));
  return resultados.flat();
}

// ─── Cálculo dos KRs ────────────────────────────────────────────────────────

// Fórmula:
//   Numerador   = OS tipo=Garantia (status ≠ CANCELADA) + OS status=CANCELADA (qualquer tipo)
//   Denominador = OS tipo=Venda Ótica
function calcularGarantiasCancelamentos(
  ordens: any[],
  _vendas: any[],
): { pct: number | null; qtd: number; total: number } {
  const garantiasNaoCanceladas = ordens.filter(
    (os) => os.tipo_os === "Garantia" && os.status !== "CANCELADA",
  );
  const canceladas = ordens.filter((os) => os.status === "CANCELADA");
  const vendasOtica = ordens.filter((os) => os.tipo_os === "Venda Ótica");

  const numerador   = garantiasNaoCanceladas.length + canceladas.length;
  const denominador = vendasOtica.length;

  if (denominador === 0) return { pct: null, qtd: numerador, total: 0 };

  return {
    pct:   +((numerador / denominador) * 100).toFixed(2),
    qtd:   numerador,
    total: denominador,
  };
}

function calcularLuzter(vendas: any[]): any {
  const lentes = vendas.flatMap((v) =>
    (v.itens ?? []).filter((item: any) => item.produto?.grupo === "Lente")
  );

  const totalLentes = lentes.reduce((acc, item) => acc + (item.valor_total_liquido ?? 0), 0);
  if (totalLentes === 0) return { pct: null, valorLuzter: 0, valorTotalLentes: 0, outras: null, detalhes: [] };

  const valorLuzter = lentes
    .filter((item) => item.produto?.grife === "Luzter")
    .reduce((acc, item) => acc + (item.valor_total_liquido ?? 0), 0);

  const pctLuzter = +((valorLuzter / totalLentes) * 100).toFixed(2);

  const porRef = new Map<string, number>();
  for (const item of lentes.filter((i) => i.produto?.grife === "Luzter")) {
    const ref = item.produto?.referencia ?? "Sem Referência";
    porRef.set(ref, (porRef.get(ref) ?? 0) + (item.valor_total_liquido ?? 0));
  }
  const detalhesLuzter = Array.from(porRef.entries())
    .map(([referencia, valor]) => ({
      referencia,
      valor: +valor.toFixed(2),
      pct: +((valor / totalLentes) * 100).toFixed(2),
    }))
    .sort((a, b) => b.valor - a.valor);

  return {
    pct: pctLuzter,
    valorLuzter: +valorLuzter.toFixed(2),
    valorTotalLentes: +totalLentes.toFixed(2),
    outras: { pct: +(100 - pctLuzter).toFixed(2), valor: +(totalLentes - valorLuzter).toFixed(2) },
    detalhes: detalhesLuzter,
  };
}

const GRUPOS_ARMACAO = ["Armação Acetato", "Armação Metal", "Solar Acetato", "Solar Metal"];

const isBinniVolt = (grife: string) => /^binni/i.test(grife) || grife === "Volt";

function calcularBinni(vendas: any[]): any {
  const armacoes = vendas.flatMap((v) =>
    (v.itens ?? []).filter((item: any) => GRUPOS_ARMACAO.includes(item.produto?.grupo))
  );

  const totalArmacoes = armacoes.reduce((acc, item) => acc + (item.valor_total_liquido ?? 0), 0);
  if (totalArmacoes === 0) return { pct: null, valorBinni: 0, valorTotalArmacoes: 0, outras: null, detalhes: [], porGrupo: {} };

  const valorBinni = armacoes
    .filter((item) => isBinniVolt(item.produto?.grife ?? ""))
    .reduce((acc, item) => acc + (item.valor_total_liquido ?? 0), 0);

  const pctBinni = +((valorBinni / totalArmacoes) * 100).toFixed(2);

  // Detalhes globais por grife (para compatibilidade)
  const grifeMap = new Map<string, number>();
  for (const item of armacoes.filter((i) => isBinniVolt(i.produto?.grife ?? ""))) {
    const g = item.produto?.grife ?? "Sem Grife";
    grifeMap.set(g, (grifeMap.get(g) ?? 0) + (item.valor_total_liquido ?? 0));
  }
  const detalhes = Array.from(grifeMap.entries())
    .map(([grife, valor]) => ({ grife, valor: +valor.toFixed(2), pct: +((valor / totalArmacoes) * 100).toFixed(2) }))
    .sort((a, b) => b.valor - a.valor);

  // Detalhes por grupo de produto (para filtro interativo no frontend)
  const porGrupo: Record<string, any> = {};
  for (const grupo of GRUPOS_ARMACAO) {
    const itensGrupo = armacoes.filter((item) => item.produto?.grupo === grupo);
    const valorTotalGrupo = itensGrupo.reduce((acc, item) => acc + (item.valor_total_liquido ?? 0), 0);
    const itensBinniGrupo = itensGrupo.filter((item) => isBinniVolt(item.produto?.grife ?? ""));
    const valorBinniGrupo = itensBinniGrupo.reduce((acc, item) => acc + (item.valor_total_liquido ?? 0), 0);

    const grifeGrupoMap = new Map<string, number>();
    for (const item of itensBinniGrupo) {
      const g = item.produto?.grife ?? "Sem Grife";
      grifeGrupoMap.set(g, (grifeGrupoMap.get(g) ?? 0) + (item.valor_total_liquido ?? 0));
    }

    porGrupo[grupo] = {
      valorTotal:  +valorTotalGrupo.toFixed(2),
      valorBinni:  +valorBinniGrupo.toFixed(2),
      outrasValor: +(valorTotalGrupo - valorBinniGrupo).toFixed(2),
      items: Array.from(grifeGrupoMap.entries())
        .map(([grife, valor]) => ({ grife, valor: +valor.toFixed(2) }))
        .sort((a, b) => b.valor - a.valor),
    };
  }

  return {
    pct: pctBinni,
    valorBinni:         +valorBinni.toFixed(2),
    valorTotalArmacoes: +totalArmacoes.toFixed(2),
    outras: { pct: +(100 - pctBinni).toFixed(2), valor: +(totalArmacoes - valorBinni).toFixed(2) },
    detalhes,
    porGrupo,
  };
}

// ─── Serialização do cache → response ───────────────────────────────────────

function cacheToOperacional(c: any) {
  return {
    garantiasCancelamentos: {
      pct:   c.garantiasAtual,
      qtd:   c.garantiasQtd   ?? 0,
      total: c.garantiasTotal ?? 0,
    },
    luzter: {
      pct:              c.luzterAtual,
      valorLuzter:      c.valorLuzter       ?? 0,
      valorTotalLentes: c.valorTotalLentes   ?? 0,
      outras: c.luzterOutrasPct != null
        ? { pct: c.luzterOutrasPct, valor: c.luzterOutrasValor ?? 0 }
        : null,
      detalhes: (c.detalhesLuzter as any[]) ?? [],
    },
    binni: (() => {
      const raw = c.detalhesBinni as any;
      const detalhes = Array.isArray(raw) ? raw : (raw?.items ?? []);
      const porGrupo = Array.isArray(raw) ? null : (raw?.porGrupo ?? null);
      return {
        pct:               c.binniAtual,
        valorBinni:        c.valorBinni          ?? 0,
        valorTotalArmacoes: c.valorTotalArmacoes ?? 0,
        outras: c.binniOutrasPct != null
          ? { pct: c.binniOutrasPct, valor: c.binniOutrasValor ?? 0 }
          : null,
        detalhes,
        porGrupo,
      };
    })(),
  };
}

// ─── Rotas ──────────────────────────────────────────────────────────────────

/**
 * GET /operacional/explorar/:trimestre?cnpj=...
 * Retorna valores únicos de campos da API ssOtica para validação de filtros.
 * Nunca usa cache — acesso direto à API.
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
    const [ordens, vendas] = await Promise.all([
      fetchOSTrimestre(cnpj, trimestre),
      fetchVendasTrimestre(cnpj, trimestre),
    ]);

    const itensVendas = vendas.flatMap((v) => v.itens ?? []);

    return res.json({
      cnpj,
      trimestre,
      os: {
        total:        ordens.length,
        statusUnicos: [...new Set(ordens.map((os) => os.status))],
        etapasUnicas: [...new Set(ordens.map((os) => os.etapa_atual))],
        tiposOS:      [...new Set(ordens.map((os) => os.tipo_os))],
      },
      vendas: {
        total:          vendas.length,
        totalItens:     itensVendas.length,
        gruposUnicos:   [...new Set(itensVendas.map((i: any) => i.produto?.grupo).filter(Boolean))],
        grifesLentes: [
          ...new Set(
            itensVendas
              .filter((i: any) => i.produto?.grupo === "Lente")
              .map((i: any) => i.produto?.grife)
              .filter(Boolean)
          ),
        ],
        grifesArmacoes: [
          ...new Set(
            itensVendas
              .filter((i: any) => GRUPOS_ARMACAO.includes(i.produto?.grupo))
              .map((i: any) => i.produto?.grife)
              .filter(Boolean)
          ),
        ],
      },
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /operacional/garantias-spike/:trimestre?cnpj=...
 * Spike de validação: filtra OS com Tipo=Garantia e Situação=Entregue|Não Entregue
 * e calcula pct sobre COUNT de vendas do período. Nunca usa cache.
 * Retorna diagnóstico completo para confirmar campos e fórmula.
 */
router.get("/garantias-spike/:trimestre", async (req, res) => {
  const schema = z.object({
    cnpj:      z.string().min(14).max(18),
    trimestre: z.string().regex(/^\dT\d{2}$/),
  });

  const parsed = schema.safeParse({ cnpj: req.query.cnpj, trimestre: req.params.trimestre });
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { cnpj, trimestre } = parsed.data;

  // API ssOtica usa uppercase: ENTREGUE = Entregue, ABERTO = Não Entregue
  const SITUACOES_ALVO = ["ENTREGUE", "ABERTO"];

  try {
    const [ordens, vendas] = await Promise.all([
      fetchOSTrimestre(cnpj, trimestre),
      fetchVendasTrimestre(cnpj, trimestre),
    ]);

    const garantiasNaoCanceladas = ordens.filter(
      (os) => os.tipo_os === "Garantia" && os.status !== "CANCELADA",
    );
    const canceladas  = ordens.filter((os) => os.status === "CANCELADA");
    const vendasOtica = ordens.filter((os) => os.tipo_os === "Venda Ótica");

    const numerador   = garantiasNaoCanceladas.length + canceladas.length;
    const denominador = vendasOtica.length;
    const pct = denominador > 0 ? +((numerador / denominador) * 100).toFixed(2) : null;

    return res.json({
      cnpj,
      trimestre,
      formula: "(OS tipo=Garantia não canceladas + OS canceladas qualquer tipo) / OS tipo=Venda Ótica",
      resultado: { numerador, denominador, pct },
      diagnostico: {
        totalOS:                ordens.length,
        garantiasNaoCanceladas: garantiasNaoCanceladas.length,
        canceladas:             canceladas.length,
        vendasOtica:            vendasOtica.length,
        combinacoes: [
          ...new Map(
            ordens.map((os) => [`${os.tipo_os}|${os.status}`, { tipo_os: os.tipo_os, status: os.status }])
          ).values(),
        ],
      },
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /operacional/:trimestre?cnpj=...
 * DB-first: retorna do cache se disponível e fresco.
 * Recalcula via ssOtica apenas quando necessário e salva no banco.
 */
router.get("/:trimestre", async (req, res) => {
  const schema = z.object({
    cnpj:      z.string().min(14).max(18),
    trimestre: z.string().regex(/^\dT\d{2}$/, "Use formato: 2T26"),
  });

  const parsed = schema.safeParse({ cnpj: req.query.cnpj, trimestre: req.params.trimestre });
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { cnpj, trimestre } = parsed.data;

  try {
    const loja = await prisma.loja.findUnique({ where: { cnpj } });
    if (!loja) return res.status(404).json({ error: `Loja com CNPJ ${cnpj} não encontrada.` });

    const janelas    = trimestreToJanelas(trimestre);
    const periodoOut = { inicio: janelas[0].inicio, fim: janelas[2].fim };
    const lojaOut    = { id: loja.id, name: loja.name, cidade: loja.cidade };

    // ── Verifica cache ───────────────────────────────────────────────────────
    const cached = await prisma.metaOperacional.findUnique({
      where: { lojaId_trimestre: { lojaId: loja.id, trimestre } },
    });

    const force = req.query.force === 'true';
    if (!force && isCacheFresh(cached, trimestre)) {
      return res.json({
        cnpj, trimestre,
        loja: lojaOut,
        periodo: periodoOut,
        fonte: "cache",
        operacional: cacheToOperacional(cached),
      });
    }

    // ── Cache miss / stale → busca na API ────────────────────────────────────
    const [ordens, vendas] = await Promise.all([
      fetchOSTrimestre(cnpj, trimestre),
      fetchVendasTrimestre(cnpj, trimestre),
    ]);

    const gC     = calcularGarantiasCancelamentos(ordens, vendas);
    const luzter = calcularLuzter(vendas);
    const binni  = calcularBinni(vendas);

    const cacheData = {
      garantiasAtual:     gC.pct,
      garantiasQtd:       gC.qtd,
      garantiasTotal:     gC.total,
      luzterAtual:        luzter.pct,
      valorLuzter:        luzter.valorLuzter,
      valorTotalLentes:   luzter.valorTotalLentes,
      detalhesLuzter:     luzter.detalhes,
      luzterOutrasPct:    luzter.outras?.pct    ?? null,
      luzterOutrasValor:  luzter.outras?.valor  ?? null,
      binniAtual:         binni.pct,
      valorBinni:         binni.valorBinni,
      valorTotalArmacoes: binni.valorTotalArmacoes,
      detalhesBinni:      { items: binni.detalhes, porGrupo: binni.porGrupo },
      binniOutrasPct:     binni.outras?.pct   ?? null,
      binniOutrasValor:   binni.outras?.valor ?? null,
      lastCalculatedAt:   new Date(),
      calculationStatus:  "success",
      errorMessage:       null,
    };

    // Herda as metas do trimestre mais recente já configurado para esta loja
    const metasHerdadas = await prisma.metaOperacional.findFirst({
      where:   { lojaId: loja.id },
      orderBy: { trimestre: 'desc' },
      select:  { garantiasMeta: true, luzterMeta: true, binniMeta: true },
    });

    await prisma.metaOperacional.upsert({
      where:  { lojaId_trimestre: { lojaId: loja.id, trimestre } },
      update: cacheData,
      create: {
        lojaId:        loja.id,
        trimestre,
        garantiasMeta: metasHerdadas?.garantiasMeta ?? META_GARANTIAS,
        luzterMeta:    metasHerdadas?.luzterMeta    ?? META_LUZTER,
        binniMeta:     metasHerdadas?.binniMeta     ?? META_BINNI,
        ...cacheData,
      },
    });

    return res.json({
      cnpj, trimestre,
      loja: lojaOut,
      periodo: periodoOut,
      fonte: "api",
      operacional: {
        garantiasCancelamentos: gC,
        luzter,
        binni,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /operacional/:trimestre?cnpj=...  (exige ADMIN_2+)
 * Atualiza apenas os valores de meta no banco, sem recalcular via ssOtica.
 * Se o registro ainda não existe, cria com status "pending".
 */
router.patch("/:trimestre", requireLevel("ADMIN_2"), async (req, res) => {
  const paramsSchema = z.object({
    cnpj:      z.string().min(14).max(18),
    trimestre: z.string().regex(/^\dT\d{2}$/, "Use formato: 2T26"),
  });
  const bodySchema = z.object({
    garantiasMeta: z.number(),
    luzterMeta:    z.number(),
    binniMeta:     z.number(),
  });

  console.log(`[PATCH /operacional] user=${req.user?.email} | query=`, req.query, `| body=`, req.body);

  const params = paramsSchema.safeParse({ cnpj: req.query.cnpj, trimestre: req.params.trimestre });
  if (!params.success) {
    console.log(`[PATCH /operacional] params inválidos:`, params.error.flatten());
    return res.status(400).json({ error: params.error.flatten() });
  }

  const body = bodySchema.safeParse(req.body);
  if (!body.success) {
    console.log(`[PATCH /operacional] body inválido:`, body.error.flatten());
    return res.status(400).json({ error: body.error.flatten() });
  }

  const { cnpj, trimestre } = params.data;
  const { garantiasMeta, luzterMeta, binniMeta } = body.data;

  try {
    const loja = await prisma.loja.findUnique({ where: { cnpj } });
    if (!loja) {
      console.log(`[PATCH /operacional] loja não encontrada: ${cnpj}`);
      return res.status(404).json({ error: `Loja com CNPJ ${cnpj} não encontrada.` });
    }

    console.log(`[PATCH /operacional] upsert → lojaId=${loja.id} trimestre=${trimestre} metas=`, { garantiasMeta, luzterMeta, binniMeta });

    const meta = await prisma.metaOperacional.upsert({
      where:  { lojaId_trimestre: { lojaId: loja.id, trimestre } },
      update: { garantiasMeta, luzterMeta, binniMeta },
      create: {
        lojaId: loja.id,
        trimestre,
        garantiasMeta,
        luzterMeta,
        binniMeta,
        calculationStatus: "pending",
      },
    });

    console.log(`[PATCH /operacional] ✓ salvo id=${meta.id}`);
    return res.json({ id: meta.id, lojaId: loja.id, trimestre, garantiasMeta, luzterMeta, binniMeta });
  } catch (err: any) {
    console.error(`[PATCH /operacional] ERRO:`, err.message);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /operacional/:trimestre?cnpj=...
 * Força recálculo via ssOtica, salva no banco e retorna resultado.
 * Body opcional: { garantiasMeta, luzterMeta, binniMeta }
 */
router.post("/:trimestre", requireLevel("ADMIN_2"), async (req, res) => {
  const paramsSchema = z.object({
    cnpj:      z.string().min(14).max(18),
    trimestre: z.string().regex(/^\dT\d{2}$/, "Use formato: 2T26"),
  });
  const bodySchema = z.object({
    garantiasMeta: z.number().optional(),
    luzterMeta:    z.number().optional(),
    binniMeta:     z.number().optional(),
  }).optional();

  const params = paramsSchema.safeParse({ cnpj: req.query.cnpj, trimestre: req.params.trimestre });
  if (!params.success) return res.status(400).json({ error: params.error.flatten() });

  const body = bodySchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: body.error.flatten() });

  const { cnpj, trimestre } = params.data;
  const metas = body.data ?? {};

  try {
    const loja = await prisma.loja.findUnique({ where: { cnpj } });
    if (!loja) return res.status(404).json({ error: `Loja com CNPJ ${cnpj} não encontrada.` });

    const [ordens, vendas] = await Promise.all([
      fetchOSTrimestre(cnpj, trimestre),
      fetchVendasTrimestre(cnpj, trimestre),
    ]);

    const gC     = calcularGarantiasCancelamentos(ordens, vendas);
    const luzter = calcularLuzter(vendas);
    const binni  = calcularBinni(vendas);

    const meta = await prisma.metaOperacional.upsert({
      where:  { lojaId_trimestre: { lojaId: loja.id, trimestre } },
      update: {
        garantiasAtual:     gC.pct,
        garantiasQtd:       gC.qtd,
        garantiasTotal:     gC.total,
        garantiasMeta:      metas.garantiasMeta ?? META_GARANTIAS,
        luzterAtual:        luzter.pct,
        valorLuzter:        luzter.valorLuzter,
        valorTotalLentes:   luzter.valorTotalLentes,
        detalhesLuzter:     luzter.detalhes,
        luzterOutrasPct:    luzter.outras?.pct    ?? null,
        luzterOutrasValor:  luzter.outras?.valor  ?? null,
        luzterMeta:         metas.luzterMeta ?? META_LUZTER,
        binniAtual:         binni.pct,
        valorBinni:         binni.valorBinni,
        valorTotalArmacoes: binni.valorTotalArmacoes,
        detalhesBinni:      { items: binni.detalhes, porGrupo: binni.porGrupo },
        binniOutrasPct:     binni.outras?.pct   ?? null,
        binniOutrasValor:   binni.outras?.valor ?? null,
        binniMeta:          metas.binniMeta ?? META_BINNI,
        lastCalculatedAt:   new Date(),
        calculationStatus:  "success",
        errorMessage:       null,
      },
      create: {
        lojaId:             loja.id,
        trimestre,
        garantiasAtual:     gC.pct,
        garantiasQtd:       gC.qtd,
        garantiasTotal:     gC.total,
        garantiasMeta:      metas.garantiasMeta ?? META_GARANTIAS,
        luzterAtual:        luzter.pct,
        valorLuzter:        luzter.valorLuzter,
        valorTotalLentes:   luzter.valorTotalLentes,
        detalhesLuzter:     luzter.detalhes,
        luzterOutrasPct:    luzter.outras?.pct    ?? null,
        luzterOutrasValor:  luzter.outras?.valor  ?? null,
        luzterMeta:         metas.luzterMeta ?? META_LUZTER,
        binniAtual:         binni.pct,
        valorBinni:         binni.valorBinni,
        valorTotalArmacoes: binni.valorTotalArmacoes,
        detalhesBinni:      { items: binni.detalhes, porGrupo: binni.porGrupo },
        binniOutrasPct:     binni.outras?.pct   ?? null,
        binniOutrasValor:   binni.outras?.valor ?? null,
        binniMeta:          metas.binniMeta ?? META_BINNI,
        lastCalculatedAt:   new Date(),
        calculationStatus:  "success",
      },
    });

    return res.status(201).json({
      id: meta.id,
      lojaId: loja.id,
      trimestre,
      operacional: {
        garantiasCancelamentos: gC,
        luzter,
        binni,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /operacional/batch/:trimestre
 * Força recálculo de todas as lojas em paralelo.
 * Body opcional: { garantiasMeta, luzterMeta, binniMeta }
 */
// POST /operacional/batch/:trimestre
// Recalcula todas as lojas preservando as metas já configuradas no banco.
router.post("/batch/:trimestre", requireLevel("ADMIN_2"), async (req, res) => {
  const trimestreSchema = z.string().regex(/^\dT\d{2}$/, "Use formato: 2T26");

  const trimestreParsed = trimestreSchema.safeParse(req.params.trimestre);
  if (!trimestreParsed.success) return res.status(400).json({ error: "Trimestre inválido. Use formato: 2T26" });

  const trimestre = trimestreParsed.data;

  const lojas = await prisma.loja.findMany();
  if (!lojas.length) return res.status(404).json({ error: "Nenhuma loja cadastrada." });

  const resultados = await Promise.all(
    lojas.map(async (loja) => {
      try {
        const [ordens, vendas] = await Promise.all([
          fetchOSTrimestre(loja.cnpj, trimestre),
          fetchVendasTrimestre(loja.cnpj, trimestre),
        ]);

        const gC     = calcularGarantiasCancelamentos(ordens, vendas);
        const luzter = calcularLuzter(vendas);
        const binni  = calcularBinni(vendas);

        // Usa metas já configuradas no banco; herda do trimestre mais recente se não existir
        const metasExistentes = await prisma.metaOperacional.findUnique({
          where:  { lojaId_trimestre: { lojaId: loja.id, trimestre } },
          select: { garantiasMeta: true, luzterMeta: true, binniMeta: true },
        });
        const metasHerdadas = metasExistentes ?? await prisma.metaOperacional.findFirst({
          where:   { lojaId: loja.id },
          orderBy: { trimestre: 'desc' },
          select:  { garantiasMeta: true, luzterMeta: true, binniMeta: true },
        });

        await prisma.metaOperacional.upsert({
          where:  { lojaId_trimestre: { lojaId: loja.id, trimestre } },
          update: {
            garantiasAtual: gC.pct, garantiasQtd: gC.qtd, garantiasTotal: gC.total,
            luzterAtual: luzter.pct, valorLuzter: luzter.valorLuzter,
            valorTotalLentes: luzter.valorTotalLentes, detalhesLuzter: luzter.detalhes,
            luzterOutrasPct: luzter.outras?.pct ?? null, luzterOutrasValor: luzter.outras?.valor ?? null,
            binniAtual: binni.pct, valorBinni: binni.valorBinni,
            valorTotalArmacoes: binni.valorTotalArmacoes, detalhesBinni: { items: binni.detalhes, porGrupo: binni.porGrupo },
            binniOutrasPct: binni.outras?.pct ?? null, binniOutrasValor: binni.outras?.valor ?? null,
            lastCalculatedAt: new Date(), calculationStatus: "success", errorMessage: null,
          },
          create: {
            lojaId: loja.id, trimestre,
            garantiasAtual: gC.pct, garantiasQtd: gC.qtd, garantiasTotal: gC.total,
            garantiasMeta: metasHerdadas?.garantiasMeta ?? META_GARANTIAS,
            luzterAtual: luzter.pct, valorLuzter: luzter.valorLuzter,
            valorTotalLentes: luzter.valorTotalLentes, detalhesLuzter: luzter.detalhes,
            luzterOutrasPct: luzter.outras?.pct ?? null, luzterOutrasValor: luzter.outras?.valor ?? null,
            luzterMeta: metasHerdadas?.luzterMeta ?? META_LUZTER,
            binniAtual: binni.pct, valorBinni: binni.valorBinni,
            valorTotalArmacoes: binni.valorTotalArmacoes, detalhesBinni: { items: binni.detalhes, porGrupo: binni.porGrupo },
            binniOutrasPct: binni.outras?.pct ?? null, binniOutrasValor: binni.outras?.valor ?? null,
            binniMeta: metasHerdadas?.binniMeta ?? META_BINNI,
            lastCalculatedAt: new Date(), calculationStatus: "success",
          },
        });

        return { cnpj: loja.cnpj, name: loja.name, status: "success" };
      } catch (err: any) {
        return { cnpj: loja.cnpj, name: loja.name, status: "error", error: err.message };
      }
    })
  );

  const total  = resultados.length;
  const sucesso = resultados.filter((r) => r.status === "success").length;

  return res.status(200).json({ trimestre, total, sucesso, falha: total - sucesso, resultados });
});

export default router;
