import type { VeyraColor, VeyraMotif } from "./challenge.js";
import { decryptSecret } from "./crypto.js";
import { getUserRow } from "./db.js";

export interface UserProfile {
  userId: string;
  color: VeyraColor;
  motif: VeyraMotif;
  secretHash: string;
  secretPlain: string;
  secretLength: number;
  createdAt: number;
}

export function getUser(userId: string): UserProfile | undefined {
  const r = getUserRow(userId);
  if (!r) return undefined;
  return {
    userId: r.userId,
    color: r.color,
    motif: r.motif,
    secretHash: r.secretHash,
    secretPlain: decryptSecret(r.secretIv, r.secretData, r.secretTag),
    secretLength: r.secretLength,
    createdAt: r.createdAt,
  };
}
