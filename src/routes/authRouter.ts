import "dotenv/config";
import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { authenticateToken, requireLevel } from "../middleware/auth";

const router = Router();

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma  = new PrismaClient({ adapter });

// ─── POST /auth/login ───────────────────────────────────────────────────────
router.post("/login", async (req, res) => {
  const schema = z.object({
    email:    z.string().email(),
    password: z.string().min(1),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { email, password } = parsed.data;

  try {
    const user = await prisma.user.findUnique({
      where:   { email },
      include: { loja: true },
    });

    if (!user) return res.status(401).json({ error: "Email ou senha incorretos." });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: "Email ou senha incorretos." });

    const token = jwt.sign(
      {
        sub:      user.id,
        email:    user.email,
        type:     user.type,
        lojaId:   user.lojaId   ?? null,
        lojaCnpj: user.loja?.cnpj  ?? null,
        lojaNome: user.loja?.name  ?? null,
      },
      process.env.JWT_SECRET!,
      { expiresIn: "8h" }
    );

    return res.json({
      token,
      user: {
        id:    user.id,
        name:  user.name,
        email: user.email,
        type:  user.type,
        loja:  user.loja
          ? { id: user.loja.id, name: user.loja.name, cnpj: user.loja.cnpj, cidade: user.loja.cidade }
          : null,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /auth/me ───────────────────────────────────────────────────────────
router.get("/me", authenticateToken, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where:   { id: req.user!.sub },
      include: { loja: true },
    });
    if (!user) return res.status(404).json({ error: "Usuário não encontrado." });

    return res.json({
      id:    user.id,
      name:  user.name,
      email: user.email,
      type:  user.type,
      loja:  user.loja
        ? { id: user.loja.id, name: user.loja.name, cnpj: user.loja.cnpj, cidade: user.loja.cidade }
        : null,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /auth/lojas  (ADMIN_1) — lista lojas para preencher formulário ─────
router.get("/lojas", authenticateToken, requireLevel("ADMIN_1"), async (_req, res) => {
  try {
    const lojas = await prisma.loja.findMany({
      select: { id: true, name: true, cnpj: true, cidade: true },
      orderBy: [{ name: "asc" }, { cidade: "asc" }],
    });
    return res.json(lojas);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /auth/users  (ADMIN_1) ─────────────────────────────────────────────
router.get("/users", authenticateToken, requireLevel("ADMIN_1"), async (_req, res) => {
  try {
    const users = await prisma.user.findMany({
      include: { loja: { select: { id: true, name: true, cnpj: true, cidade: true } } },
      orderBy: [{ type: "asc" }, { name: "asc" }],
    });

    return res.json(
      users.map((u) => ({
        id:    u.id,
        name:  u.name,
        email: u.email,
        type:  u.type,
        loja:  u.loja ?? null,
      }))
    );
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── POST /auth/users  (ADMIN_1) ────────────────────────────────────────────
router.post("/users", authenticateToken, requireLevel("ADMIN_1"), async (req, res) => {
  const schema = z.object({
    name:     z.string().min(2),
    email:    z.string().email(),
    password: z.string().min(6),
    type:     z.enum(["USER", "ADMIN_3", "ADMIN_2", "ADMIN_1"]),
    lojaId:   z.string().uuid().optional().nullable(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { name, email, password, type, lojaId } = parsed.data;

  // USER precisa de lojaId
  if (type === "USER" && !lojaId) {
    return res.status(400).json({ error: "Usuários do tipo USER precisam ter uma loja vinculada." });
  }

  try {
    const hashed = await bcrypt.hash(password, 10);
    const user   = await prisma.user.create({
      data: { name, email, password: hashed, type, lojaId: lojaId ?? null },
      include: { loja: { select: { id: true, name: true, cnpj: true } } },
    });

    return res.status(201).json({
      id:    user.id,
      name:  user.name,
      email: user.email,
      type:  user.type,
      loja:  user.loja ?? null,
    });
  } catch (err: any) {
    if (err.code === "P2002") return res.status(409).json({ error: "Email já cadastrado." });
    return res.status(500).json({ error: err.message });
  }
});

// ─── PATCH /auth/users/:id  (ADMIN_1) ───────────────────────────────────────
router.patch("/users/:id", authenticateToken, requireLevel("ADMIN_1"), async (req, res) => {
  const schema = z.object({
    name:     z.string().min(2).optional(),
    password: z.string().min(6).optional(),
    type:     z.enum(["USER", "ADMIN_3", "ADMIN_2", "ADMIN_1"]).optional(),
    lojaId:   z.string().uuid().nullable().optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { name, password, type, lojaId } = parsed.data;
  const updateData: Record<string, any> = {};
  if (name     !== undefined) updateData.name    = name;
  if (type     !== undefined) updateData.type    = type;
  if (lojaId   !== undefined) updateData.lojaId  = lojaId;
  if (password !== undefined) updateData.password = await bcrypt.hash(password, 10);

  try {
    const user = await prisma.user.update({
      where:   { id: req.params.id as string },
      data:    updateData,
      include: { loja: { select: { id: true, name: true, cnpj: true } } },
    });

    return res.json({
      id:    user.id,
      name:  user.name,
      email: user.email,
      type:  user.type,
      loja:  (user as any).loja ?? null,
    });
  } catch (err: any) {
    if (err.code === "P2025") return res.status(404).json({ error: "Usuário não encontrado." });
    return res.status(500).json({ error: err.message });
  }
});

// ─── DELETE /auth/users/:id  (ADMIN_1) ──────────────────────────────────────
router.delete("/users/:id", authenticateToken, requireLevel("ADMIN_1"), async (req, res) => {
  // Impede auto-exclusão
  if (req.user!.sub === req.params.id) {
    return res.status(400).json({ error: "Você não pode excluir o próprio usuário." });
  }

  try {
    await prisma.user.delete({ where: { id: req.params.id as string } });
    return res.status(204).send();
  } catch (err: any) {
    if (err.code === "P2025") return res.status(404).json({ error: "Usuário não encontrado." });
    return res.status(500).json({ error: err.message });
  }
});

export default router;
