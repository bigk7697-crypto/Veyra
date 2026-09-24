export type RiskLevel = "low" | "medium" | "high";

export interface RiskSignals {
  durationMs: number;
  corrections: number;
  attempts: number; // 1 = premier essai
  avgIntervalMs?: number;
}

export interface RiskResult {
  risk_score: number;
  risk_level: RiskLevel;
  next_action: "none" | "retry" | "require_mfa";
}

/**
 * Risk Engine V1 déterministe (pas d'IA).
 * Score = signal, pas preuve absolue de bot.
 */
export function scoreRisk(ok: boolean, s: RiskSignals): RiskResult {
  let score = 0;

  if (!ok) score += 40;

  // Trop rapide = suspect automatisation
  if (s.durationMs < 1500) score += 30;
  else if (s.durationMs > 60000) score += 15;

  if (s.corrections > 2) score += 10;
  if (s.attempts === 2) score += 15;
  if (s.attempts >= 3) score += 25;

  if (s.avgIntervalMs !== undefined && s.avgIntervalMs < 180) score += 15;

  score = Math.max(0, Math.min(100, score));

  if (score <= 30) return { risk_score: score, risk_level: "low", next_action: ok ? "none" : "retry" };
  if (score <= 70) return { risk_score: score, risk_level: "medium", next_action: ok ? "none" : "retry" };
  return { risk_score: score, risk_level: "high", next_action: "require_mfa" };
}
