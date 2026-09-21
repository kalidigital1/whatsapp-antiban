import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";

const router = Router();
const SESSION_COOKIE = "antiban_session";
const LOGIN_USERNAME = "antiban";
const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 12;
const REMEMBERED_SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

type SessionPayload = {
  username: string;
  expiresAt: number;
  nonce: string;
};

function authSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is required for authentication.");
  return secret;
}

function normalizeUsername(value: unknown) {
  return String(value ?? "").trim().replace(/^@/, "").toLowerCase();
}

function digest(value: string) {
  return createHash("sha256").update(value).digest();
}

function safeEqual(left: string, right: string) {
  const leftDigest = digest(left);
  const rightDigest = digest(right);
  return timingSafeEqual(leftDigest, rightDigest);
}

function encodePayload(payload: SessionPayload) {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function sign(value: string) {
  return createHmac("sha256", authSecret()).update(value).digest("base64url");
}

function createSessionToken(ttlSeconds: number) {
  const payload = encodePayload({
    username: LOGIN_USERNAME,
    expiresAt: Date.now() + ttlSeconds * 1000,
    nonce: cryptoRandomNonce(),
  });
  return `${payload}.${sign(payload)}`;
}

function cryptoRandomNonce() {
  return randomBytes(18).toString("base64url");
}

function parseCookies(header: string | undefined) {
  const cookies = new Map<string, string>();
  for (const part of header?.split(";") ?? []) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key) cookies.set(key, decodeURIComponent(value));
  }
  return cookies;
}

function readSession(req: Request): SessionPayload | null {
  const token = parseCookies(req.headers.cookie).get(SESSION_COOKIE);
  if (!token) return null;
  const separator = token.lastIndexOf(".");
  if (separator <= 0) return null;

  const payloadPart = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  const expectedSignature = sign(payloadPart);
  if (!safeEqual(signature, expectedSignature)) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(payloadPart, "base64url").toString("utf8"),
    ) as Partial<SessionPayload>;
    if (
      payload.username !== LOGIN_USERNAME ||
      typeof payload.expiresAt !== "number" ||
      payload.expiresAt <= Date.now()
    ) {
      return null;
    }
    return {
      username: payload.username,
      expiresAt: payload.expiresAt,
      nonce: String(payload.nonce ?? ""),
    };
  } catch {
    return null;
  }
}

function setSessionCookie(res: Response, token: string, maxAgeSeconds?: number) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const maxAge = maxAgeSeconds === undefined ? "" : `; Max-Age=${maxAgeSeconds}`;
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(token)}${maxAge}; Path=/; HttpOnly; SameSite=Lax${secure}`,
  );
}

function clearSessionCookie(res: Response) {
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`,
  );
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!readSession(req)) {
    res.status(401).json({ error: "Não autenticado." });
    return;
  }
  next();
}

router.get("/auth/me", (req, res) => {
  const session = readSession(req);
  if (!session) {
    res.status(401).json({ authenticated: false });
    return;
  }
  res.json({ authenticated: true, username: `@${session.username}` });
});

router.post("/auth/login", (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const password = String(req.body?.password ?? "");
  const remember = req.body?.remember === true;
  const expectedPassword = process.env.APP_LOGIN_PASSWORD;

  if (!expectedPassword) {
    res.status(503).json({ error: "Login não configurado no servidor." });
    return;
  }

  if (username !== LOGIN_USERNAME || !safeEqual(password, expectedPassword)) {
    res.status(401).json({ error: "Usuário ou senha inválidos." });
    return;
  }

  const ttlSeconds = remember
    ? REMEMBERED_SESSION_TTL_SECONDS
    : DEFAULT_SESSION_TTL_SECONDS;
  setSessionCookie(
    res,
    createSessionToken(ttlSeconds),
    remember ? REMEMBERED_SESSION_TTL_SECONDS : undefined,
  );
  res.json({ authenticated: true, username: `@${LOGIN_USERNAME}` });
});

router.post("/auth/logout", (_req, res) => {
  clearSessionCookie(res);
  res.status(204).send();
});

export default router;