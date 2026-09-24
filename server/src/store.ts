import type { ChallengeCell, VeyraColor, VeyraMotif } from "./challenge.js";
import type { RiskResult } from "./risk.js";
import { deleteChallengeRow, getChallengeRow, getRiskRow, saveChallengeRow, saveRiskRow, type ChallengeRow } from "./db.js";

export interface StoredChallenge {
  id: string;
  userId?: string;
  cells: ChallengeCell[];
  solution: number[];
  userColor: VeyraColor;
  userMotif: VeyraMotif;
  secretLength: number;
  createdAt: number;
  expiresAt: number;
  attempts: number;
  maxAttempts: number;
}

function toRow(c: StoredChallenge): ChallengeRow {
  return { ...c };
}

function fromRow(c: ChallengeRow): StoredChallenge {
  return { ...c };
}

export function save(c: StoredChallenge): void {
  saveChallengeRow(toRow(c));
}

export function get(id: string): StoredChallenge | undefined {
  const r = getChallengeRow(id);
  return r ? fromRow(r) : undefined;
}

export function remove(id: string): void {
  deleteChallengeRow(id);
}

export function saveRisk(id: string, r: RiskResult & { verified: boolean }): void {
  saveRiskRow(id, r.verified, r);
}

export function getRisk(id: string): (RiskResult & { verified: boolean; at: string }) | undefined {
  return getRiskRow(id);
}
