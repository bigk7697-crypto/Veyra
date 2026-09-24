import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DATA_DIR = process.env.VERCEL ? join(tmpdir(), "veyra-data") : join(process.cwd(), "data");

function masterKey(): Buffer {
  const env = String(process.env.VEYRA_MASTER_KEY ?? "").trim();
  if (env) {
    const b = Buffer.from(env, "hex");
    if (b.length !== 32) throw new Error("VEYRA_MASTER_KEY doit faire 32 octets hex");
    return b;
  }
  const p = join(DATA_DIR, "master.key");
  if (existsSync(p)) return Buffer.from(readFileSync(p, "utf8").trim(), "hex");
  const k = randomBytes(32);
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(p, k.toString("hex"), { mode: 0o600 });
  return k;
}

// scrypt N=16384 r=8 p=1, format stocké : scrypt$saltHex$hashHex
export function hashSecretSecure(secret: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(secret.toUpperCase(), salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifySecretSecure(secret: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1], "hex");
  const expected = Buffer.from(parts[2], "hex");
  const got = scryptSync(secret.toUpperCase(), salt, 32, { N: 16384, r: 8, p: 1 });
  if (got.length !== expected.length) return false;
  return timingSafeEqual(got, expected);
}

// Chiffrement du secret pour génération grille (AES-256-GCM). Le hash scrypt sert à l'audit,
// le chiffré sert à régénérer la grille sans plaintext en base.
export function encryptSecret(plain: string): { iv: string; data: string; tag: string } {
  const key = masterKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return { iv: iv.toString("hex"), data: enc.toString("hex"), tag: cipher.getAuthTag().toString("hex") };
}

export function decryptSecret(iv: string, data: string, tag: string): string {
  const key = masterKey();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "hex"));
  decipher.setAuthTag(Buffer.from(tag, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(data, "hex")), decipher.final()]).toString("utf8");
}

// Clés API : format public veyra_<prefix8>_<secret32>, seul le hash scrypt est stocké.
export function newApiKey(): { publicKey: string; prefix: string; hash: string } {
  const prefix = randomBytes(4).toString("hex");
  const secret = randomBytes(24).toString("hex");
  const publicKey = `veyra_${prefix}_${secret}`;
  const hash = hashSecretSecure(publicKey);
  return { publicKey, prefix, hash };
}

export function verifyApiKey(candidate: string, storedHash: string): boolean {
  return verifySecretSecure(candidate, storedHash);
}
