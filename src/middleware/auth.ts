import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";

// Hierarquia numérica de permissão
export const LEVEL: Record<string, number> = {
  USER:    0,
  ADMIN_3: 1,
  ADMIN_2: 2,
  ADMIN_1: 3,
};

export interface AuthUser {
  sub:      string;
  email:    string;
  type:     string;
  lojaId:   string | null;
  lojaCnpj: string | null;
  lojaNome: string | null;
}

// Augment Express Request
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/** Verifica e decodifica o Bearer token. */
export function authenticateToken(req: Request, res: Response, next: NextFunction) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Token não fornecido." });
  }

  try {
    const payload = jwt.verify(auth.slice(7), process.env.JWT_SECRET!) as AuthUser;
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: "Token inválido ou expirado." });
  }
}

/** Exige nível mínimo de acesso. Usar após authenticateToken. */
export function requireLevel(minType: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const userLevel = LEVEL[req.user?.type ?? "USER"] ?? 0;
    if (userLevel < (LEVEL[minType] ?? 0)) {
      return res.status(403).json({ error: "Acesso negado. Permissão insuficiente." });
    }
    next();
  };
}

/**
 * Para USER: bloqueia acesso a CNPJs diferentes do vinculado.
 * ADMINs passam sem restrição.
 * Usar após authenticateToken.
 */
export function requireLojaAccess(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: "Não autenticado." });
  if (req.user.type !== "USER") return next(); // ADMIN acessa qualquer loja

  const cnpjSolicitado = req.query.cnpj as string;
  if (req.user.lojaCnpj !== cnpjSolicitado) {
    return res.status(403).json({ error: "Acesso negado. Esta loja não está vinculada ao seu usuário." });
  }
  next();
}
