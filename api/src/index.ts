import "dotenv/config";
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { cfg } from "./config.js";
import { ALL_COLORS, buildGrid, cleanMotif, cleanSecretWord, type VeyraColor } from "./challenge.js";
import { scoreRisk } from "./risk.js";
import { get, getRisk, remove, save, saveRisk } from "./store.js";
import { decryptSecret, encryptSecret, hashSecretSecure, newApiKey, verifyApiKey } from "./crypto.js";
import {
  cleanupExpired,
  countKeys,
  createKeyRow,
  deleteKeyRow,
  getKeyHashByPrefix,
  getStats,
  getUserRow,
  listEvents,
  listKeyRows,
  logEventRow,
  saveUserRow,
} from "./db.js";

const PUBLIC_DIR = join(process.cwd(), "public");

const app = Fastify({ logger: { level: cfg.logLevel as string }, trustProxy: cfg.trustProxy });

export async function buildApp(): Promise<FastifyInstance> {
  await app.register(cors, { origin: cfg.corsOrigins.length ? cfg.corsOrigins : true });
  await app.register(rateLimit, { max: cfg.rateMax, timeWindow: cfg.rateWindow });
  // En serverless (Vercel), les fichiers statics sont servis par le CDN :
  // on ne monte le dossier public que s'il existe à côté du serveur.
  if (existsSync(PUBLIC_DIR)) {
    await app.register(fastifyStatic, { root: PUBLIC_DIR, prefix: "/", index: cfg.demoEnabled ? "index.html" : false });
  }

  if (!cfg.demoEnabled) {
    app.get("/", async () => ({
      service: "veyra-api",
      version: "1.1.0",
      docs: "/dashboard.html",
      widget: "/widget.js",
      enroll: "POST /v1/enroll",
    }));
  }

  // Garde anti-abus navigateur : si WIDGET_ALLOWED_ORIGINS est défini,
  // les appels navigateur (avec Origin/Referer) hors liste sont rejetés.
  // Les appels serveur-à-serveur (sans Origin) restent autorisés.
  function browserOriginBlocked(req: { headers: Record<string, unknown> }): boolean {
    if (cfg.widgetOrigins.length === 0) return false;
    const origin = String(req.headers["origin"] ?? "");
    const referer = String(req.headers["referer"] ?? "");
    const src = origin || referer;
    if (!src) return false;
    return !cfg.widgetOrigins.some((allowed) => src.startsWith(allowed));
  }

  function extractKey(req: { headers: Record<string, unknown> }): string {
    return String(req.headers["x-api-key"] ?? "");
  }

  function requireApiKeyIfConfigured(req: { url: string; headers: Record<string, unknown> }): string | null {
    if (countKeys() === 0) return null; // mode bootstrap/dev
    if (req.url === "/health") return null;
    const k = extractKey(req);
    if (!k.startsWith("veyra_")) return null;
    const prefix = k.split("_")[1];
    if (!prefix) return null;
    const hash = getKeyHashByPrefix(prefix);
    if (!hash) return null;
    if (!verifyApiKey(k, hash)) return null;
    return prefix;
  }

  app.addHook("preHandler", async (req, reply) => {
    if (!req.url.startsWith("/v1/")) return;
    if (req.url === "/v1/keys" && req.method === "POST" && countKeys() === 0) return; // bootstrap
    if (countKeys() === 0) return;
    const ok = requireApiKeyIfConfigured(req as unknown as { url: string; headers: Record<string, unknown> });
    if (!ok) {
      return reply.code(401).send({ error: "x-api-key manquante ou invalide" });
    }
  });

  app.get("/health", async () => ({ ok: true, service: "veyra-api", version: "1.1.0" }));

  app.post("/v1/enroll", async (req, reply) => {
    const body = (req.body ?? {}) as { userId?: string; secretWord?: string; color?: string; motif?: string };
    const userId = String(body.userId ?? "").trim().slice(0, 64);
    const color = String(body.color ?? "").toLowerCase() as VeyraColor;
    const motif = cleanMotif(String(body.motif ?? "etoile"));
    const secret = cleanSecretWord(String(body.secretWord ?? ""));
    if (!userId) return reply.code(400).send({ error: "userId requis" });
    if (!ALL_COLORS.includes(color)) return reply.code(400).send({ error: "color invalide (violet|jaune|bleu)" });
    if (secret.length < 3 || secret.length > 6) return reply.code(400).send({ error: "secretWord 3-6 lettres A-Z" });
    const enc = encryptSecret(secret);
    saveUserRow({
      userId, color, motif,
      secretHash: hashSecretSecure(secret),
      secretIv: enc.iv, secretData: enc.data, secretTag: enc.tag,
      secretLength: secret.length, createdAt: Date.now(),
    });
    logEventRow("enroll", userId);
    return { ok: true, userId, color, motif };
  });

  app.post("/v1/challenges", async (req, reply) => {
    if (browserOriginBlocked(req as unknown as { headers: Record<string, unknown> })) {
      return reply.code(403).send({ error: "origine navigateur non autorisée (créez les challenges côté serveur)" });
    }
    const body = (req.body ?? {}) as { userId?: string };
    const userId = String(body.userId ?? "").trim();
    if (!userId) return reply.code(400).send({ error: "userId requis (appelez POST /v1/enroll d'abord)" });
    const row = getUserRow(userId);
    if (!row) return reply.code(404).send({ error: "user inconnu, appelez POST /v1/enroll" });
    const secret = decryptSecret(row.secretIv, row.secretData, row.secretTag);
    const { cells, solution } = buildGrid(secret, row.color, row.motif);
    const id = randomUUID();
    const now = Date.now();
    save({
      id, userId: row.userId, cells, solution,
      userColor: row.color, userMotif: row.motif,
      secretLength: row.secretLength,
      createdAt: now, expiresAt: now + cfg.ttlSeconds * 1000,
      attempts: 0, maxAttempts: cfg.maxAttempts,
    });
    logEventRow("challenge.created", row.userId, id);
    return {
      id, grid: cells, ttlSeconds: cfg.ttlSeconds,
      expiresAt: new Date(now + cfg.ttlSeconds * 1000).toISOString(),
      instruction: `Clique dans l'ordre les lettres de ton mot secret en ${row.color} ${row.motif}.`,
    };
  });

  app.get("/v1/challenges/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const c = get(id);
    if (!c) return reply.code(404).send({ error: "challenge introuvable ou expiré" });
    return { id: c.id, grid: c.cells, expiresAt: new Date(c.expiresAt).toISOString(), attemptsLeft: c.maxAttempts - c.attempts };
  });

  app.post("/v1/challenges/:id/verify", async (req, reply) => {
    if (browserOriginBlocked(req as unknown as { headers: Record<string, unknown> })) {
      return reply.code(403).send({ error: "origine navigateur non autorisée" });
    }
    const { id } = req.params as { id: string };
    const c = get(id);
    if (!c) return reply.code(404).send({ error: "challenge introuvable ou expiré" });
    const body = (req.body ?? {}) as { selections?: number[]; durationMs?: number; corrections?: number; avgIntervalMs?: number };
    const selections = Array.isArray(body.selections) ? body.selections : [];
    const durationMs = Math.max(0, Number(body.durationMs ?? 0));
    const corrections = Math.max(0, Number(body.corrections ?? 0));
    const avgIntervalMs = body.avgIntervalMs !== undefined ? Number(body.avgIntervalMs) : undefined;
    c.attempts += 1;

    let ok = selections.length === c.solution.length;
    if (ok) {
      for (let i = 0; i < c.solution.length; i++) {
        const selIdx = selections[i];
        const expectedIdx = c.solution[i];
        const cell = c.cells[selIdx];
        if (selIdx !== expectedIdx || !cell || cell.color !== c.userColor || cell.motif !== c.userMotif) {
          ok = false;
          break;
        }
      }
    }
    const risk = scoreRisk(ok, { durationMs, corrections, attempts: c.attempts, avgIntervalMs });

    if (ok) {
      remove(id);
      const out = { verified: true, risk_score: risk.risk_score, risk_level: risk.risk_level, next_action: "none" as const };
      saveRisk(id, out);
      logEventRow("challenge.verified", c.userId, id, risk.risk_level, { risk_score: risk.risk_score });
      return out;
    }
    if (c.attempts >= c.maxAttempts) {
      remove(id);
      const out = { verified: false, risk_score: risk.risk_score, risk_level: "high" as const, next_action: "require_mfa" as const };
      saveRisk(id, out);
      logEventRow("challenge.blocked", c.userId, id, "high", { risk_score: out.risk_score });
      return out;
    }
    save(c);
    const out = { verified: false, risk_score: risk.risk_score, risk_level: risk.risk_level, next_action: risk.next_action, attemptsLeft: c.maxAttempts - c.attempts };
    saveRisk(id, { verified: false, risk_score: risk.risk_score, risk_level: risk.risk_level, next_action: risk.next_action });
    logEventRow("challenge.failed", c.userId, id, risk.risk_level, { risk_score: risk.risk_score, attemptsLeft: out.attemptsLeft });
    return out;
  });

  app.get("/v1/security/risk/:session_id", async (req, reply) => {
    const { session_id } = req.params as { session_id: string };
    const r = getRisk(session_id);
    if (!r) return reply.code(404).send({ error: "session inconnue" });
    return { session_id, ...r };
  });

  app.post("/v1/events", async (req) => {
    const body = (req.body ?? {}) as { type?: string; userId?: string; sessionId?: string; riskLevel?: string; meta?: unknown };
    const type = String(body.type ?? "app.event").slice(0, 64);
    logEventRow(type, body.userId ? String(body.userId) : undefined, body.sessionId ? String(body.sessionId) : undefined, body.riskLevel ? String(body.riskLevel) : undefined, body.meta);
    return { ok: true };
  });

  app.get("/v1/events", async (req) => {
    const q = (req.query ?? {}) as { limit?: string };
    const limit = Math.min(200, Math.max(1, Number(q.limit ?? 50)));
    return { events: listEvents(limit) };
  });

  app.get("/v1/stats", async () => getStats());

  app.post("/v1/keys", async (req, reply) => {
    const body = (req.body ?? {}) as { name?: string };
    const name = String(body.name ?? "default").slice(0, 64);
    const { publicKey, prefix, hash } = newApiKey();
    try {
      createKeyRow(prefix, name, hash);
    } catch {
      return reply.code(500).send({ error: "création clé impossible" });
    }
    logEventRow("apikey.created", undefined, undefined, undefined, { prefix, name });
    return { key: publicKey, prefix, name, warning: "Copiez la clé maintenant, elle ne sera plus affichée." };
  });

  app.get("/v1/keys", async () => ({ keys: listKeyRows() }));

  app.delete("/v1/keys/:prefix", async (req, reply) => {
    const { prefix } = req.params as { prefix: string };
    if (!deleteKeyRow(prefix)) return reply.code(404).send({ error: "clé inconnue" });
    logEventRow("apikey.deleted", undefined, undefined, undefined, { prefix });
    return { ok: true };
  });

  // Compat : l'ancien widget embarqué reste servi pour les intégrations externes
  app.get("/widget.js", async (_req, reply) => {
    return reply.sendFile("widget.js");
  });

  setInterval(() => {
    try {
      cleanupExpired();
    } catch (err) {
      app.log.error(err);
    }
  }, 60_000).unref();

  return app;
}

async function main(): Promise<void> {
  const app = await buildApp();

  const shutdown = async (): Promise<void> => {
    try {
      await app.close();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  try {
    await app.listen({ port: cfg.port, host: "0.0.0.0" });
    console.log(`Veyra API 1.1 listening on http://localhost:${cfg.port} (demo=${cfg.demoEnabled ? "on" : "off"})`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

if (require.main === module) void main();
