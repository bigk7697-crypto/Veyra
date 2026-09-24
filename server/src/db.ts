import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChallengeCell, VeyraColor, VeyraMotif } from "./challenge.js";
import type { RiskResult } from "./risk.js";

// Serverless (Vercel) : filesystem en lecture seule hors /tmp.
// Les données y sont éphémères (reset à chaque cold start) :
// OK pour la démo, Postgres (db/schema.sql) pour la prod durable.
const DATA_DIR = process.env.VERCEL ? join(tmpdir(), "veyra-data") : join(process.cwd(), "data");
mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(join(DATA_DIR, "veyra.db"));

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  color TEXT NOT NULL,
  motif TEXT NOT NULL,
  secret_hash TEXT NOT NULL,
  secret_iv TEXT NOT NULL,
  secret_data TEXT NOT NULL,
  secret_tag TEXT NOT NULL,
  secret_length INT NOT NULL,
  created_at INT NOT NULL
);
CREATE TABLE IF NOT EXISTS challenges (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  cells TEXT NOT NULL,
  solution TEXT NOT NULL,
  user_color TEXT NOT NULL,
  user_motif TEXT NOT NULL,
  secret_length INT NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 3,
  created_at INT NOT NULL,
  expires_at INT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_challenges_expires ON challenges(expires_at);
CREATE TABLE IF NOT EXISTS risk_sessions (
  session_id TEXT PRIMARY KEY,
  verified INT NOT NULL,
  risk_score INT NOT NULL,
  risk_level TEXT NOT NULL,
  next_action TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS api_keys (
  prefix TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  created_at INT NOT NULL
);
CREATE TABLE IF NOT EXISTS security_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  user_id TEXT,
  session_id TEXT,
  risk_level TEXT,
  meta TEXT,
  at INT NOT NULL
);
`);

export interface UserRow {
  userId: string;
  color: VeyraColor;
  motif: VeyraMotif;
  secretHash: string;
  secretIv: string;
  secretData: string;
  secretTag: string;
  secretLength: number;
  createdAt: number;
}

export function saveUserRow(u: UserRow): void {
  db.prepare(
    `INSERT INTO users (user_id,color,motif,secret_hash,secret_iv,secret_data,secret_tag,secret_length,created_at)
     VALUES (?,?,?,?,?,?,?,?,?)
     ON CONFLICT(user_id) DO UPDATE SET color=excluded.color, motif=excluded.motif,
       secret_hash=excluded.secret_hash, secret_iv=excluded.secret_iv, secret_data=excluded.secret_data,
       secret_tag=excluded.secret_tag, secret_length=excluded.secret_length`
  ).run(u.userId, u.color, u.motif, u.secretHash, u.secretIv, u.secretData, u.secretTag, u.secretLength, u.createdAt);
}

export function getUserRow(userId: string): UserRow | undefined {
  const r = db.prepare(`SELECT * FROM users WHERE user_id=?`).get(userId) as Record<string, unknown> | undefined;
  if (!r) return undefined;
  return {
    userId: String(r.user_id),
    color: String(r.color) as VeyraColor,
    motif: String(r.motif) as VeyraMotif,
    secretHash: String(r.secret_hash),
    secretIv: String(r.secret_iv),
    secretData: String(r.secret_data),
    secretTag: String(r.secret_tag),
    secretLength: Number(r.secret_length),
    createdAt: Number(r.created_at),
  };
}

export interface ChallengeRow {
  id: string;
  userId?: string;
  cells: ChallengeCell[];
  solution: number[];
  userColor: VeyraColor;
  userMotif: VeyraMotif;
  secretLength: number;
  attempts: number;
  maxAttempts: number;
  createdAt: number;
  expiresAt: number;
}

export function saveChallengeRow(c: ChallengeRow): void {
  db.prepare(
    `INSERT INTO challenges (id,user_id,cells,solution,user_color,user_motif,secret_length,attempts,max_attempts,created_at,expires_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET attempts=excluded.attempts`
  ).run(
    c.id, c.userId ?? null, JSON.stringify(c.cells), JSON.stringify(c.solution),
    c.userColor, c.userMotif, c.secretLength, c.attempts, c.maxAttempts, c.createdAt, c.expiresAt
  );
}

export function getChallengeRow(id: string): ChallengeRow | undefined {
  const r = db.prepare(`SELECT * FROM challenges WHERE id=?`).get(id) as Record<string, unknown> | undefined;
  if (!r) return undefined;
  const expiresAt = Number(r.expires_at);
  if (Date.now() > expiresAt) {
    db.prepare(`DELETE FROM challenges WHERE id=?`).run(id);
    return undefined;
  }
  return {
    id: String(r.id),
    userId: r.user_id ? String(r.user_id) : undefined,
    cells: JSON.parse(String(r.cells)) as ChallengeCell[],
    solution: JSON.parse(String(r.solution)) as number[],
    userColor: String(r.user_color) as VeyraColor,
    userMotif: String(r.user_motif) as VeyraMotif,
    secretLength: Number(r.secret_length),
    attempts: Number(r.attempts),
    maxAttempts: Number(r.max_attempts),
    createdAt: Number(r.created_at),
    expiresAt,
  };
}

export function deleteChallengeRow(id: string): void {
  db.prepare(`DELETE FROM challenges WHERE id=?`).run(id);
}

export function cleanupExpired(): number {
  const r = db.prepare(`DELETE FROM challenges WHERE expires_at<?`).run(Date.now()) as unknown as { changes: number | bigint };
  return Number(r.changes ?? 0);
}

export function saveRiskRow(sessionId: string, verified: boolean, r: RiskResult): void {
  db.prepare(
    `INSERT INTO risk_sessions (session_id,verified,risk_score,risk_level,next_action,at)
     VALUES (?,?,?,?,?,?) ON CONFLICT(session_id) DO UPDATE SET verified=excluded.verified,
     risk_score=excluded.risk_score, risk_level=excluded.risk_level, next_action=excluded.next_action, at=excluded.at`
  ).run(sessionId, verified ? 1 : 0, r.risk_score, r.risk_level, r.next_action, new Date().toISOString());
}

export function getRiskRow(sessionId: string): (RiskResult & { verified: boolean; at: string }) | undefined {
  const r = db.prepare(`SELECT * FROM risk_sessions WHERE session_id=?`).get(sessionId) as Record<string, unknown> | undefined;
  if (!r) return undefined;
  return {
    verified: Number(r.verified) === 1,
    risk_score: Number(r.risk_score),
    risk_level: String(r.risk_level) as RiskResult["risk_level"],
    next_action: String(r.next_action) as RiskResult["next_action"],
    at: String(r.at),
  };
}

export function createKeyRow(prefix: string, name: string, keyHash: string): void {
  db.prepare(`INSERT INTO api_keys (prefix,name,key_hash,created_at) VALUES (?,?,?,?)`).run(prefix, name, keyHash, Date.now());
}

export function listKeyRows(): { prefix: string; name: string; created_at: number }[] {
  return (db.prepare(`SELECT prefix,name,created_at FROM api_keys ORDER BY created_at DESC`).all() as Record<string, unknown>[]).map((r) => ({
    prefix: String(r.prefix),
    name: String(r.name),
    created_at: Number(r.created_at),
  }));
}

export function getKeyHashByPrefix(prefix: string): string | undefined {
  const r = db.prepare(`SELECT key_hash FROM api_keys WHERE prefix=?`).get(prefix) as Record<string, unknown> | undefined;
  return r ? String(r.key_hash) : undefined;
}

export function deleteKeyRow(prefix: string): boolean {
  const r = db.prepare(`DELETE FROM api_keys WHERE prefix=?`).run(prefix) as unknown as { changes: number | bigint };
  return Number(r.changes ?? 0) > 0;
}

export function countKeys(): number {
  const r = db.prepare(`SELECT COUNT(*) AS n FROM api_keys`).get() as Record<string, unknown>;
  return Number(r.n);
}

export function logEventRow(type: string, userId?: string, sessionId?: string, riskLevel?: string, meta?: unknown): void {
  db.prepare(`INSERT INTO security_events (type,user_id,session_id,risk_level,meta,at) VALUES (?,?,?,?,?,?)`).run(
    type, userId ?? null, sessionId ?? null, riskLevel ?? null, meta ? JSON.stringify(meta) : null, Date.now()
  );
}

export function listEvents(limit = 50): Record<string, unknown>[] {
  return (db.prepare(`SELECT id,type,user_id,session_id,risk_level,meta,at FROM security_events ORDER BY id DESC LIMIT ?`).all(limit) as Record<string, unknown>[]).map((r) => ({
    id: r.id,
    type: r.type,
    user_id: r.user_id,
    session_id: r.session_id,
    risk_level: r.risk_level,
    meta: r.meta ? JSON.parse(String(r.meta)) : null,
    at: new Date(Number(r.at)).toISOString(),
  }));
}

export function getStats(): {
  users: number; challenges_total: number; challenges_active: number;
  verified: number; blocked: number; high_risk: number; events: number;
} {
  const count = (sql: string): number => {
    const r = db.prepare(sql).get() as unknown as Record<string, unknown>;
    return Number(Object.values(r)[0]);
  };
  const now = Date.now();
  const active = db.prepare(`SELECT COUNT(*) AS n FROM challenges WHERE expires_at>?`).get(now) as unknown as Record<string, unknown>;
  return {
    users: count(`SELECT COUNT(*) AS n FROM users`),
    challenges_total: count(`SELECT COUNT(*) AS n FROM challenges`) + count(`SELECT COUNT(*) AS n FROM risk_sessions`),
    challenges_active: Number(active.n),
    verified: count(`SELECT COUNT(*) AS n FROM risk_sessions WHERE verified=1`),
    blocked: count(`SELECT COUNT(*) AS n FROM risk_sessions WHERE verified=0 AND risk_level='high'`),
    high_risk: count(`SELECT COUNT(*) AS n FROM risk_sessions WHERE risk_level='high'`),
    events: count(`SELECT COUNT(*) AS n FROM security_events`),
  };
}
