// Configuration prod via variables d'environnement (voir .env.example).
// Toute valeur a un défaut sûr pour le dev local.

function str(name: string, def: string): string {
  const v = String(process.env[name] ?? "").trim();
  return v || def;
}

function num(name: string, def: number, min: number, max: number): number {
  const raw = String(process.env[name] ?? "").trim();
  if (!raw) return def;
  const n = Number(raw);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function list(name: string): string[] {
  return String(process.env[name] ?? "")
    .split(",")
    .map((s) => s.trim().replace(/\/$/, ""))
    .filter(Boolean);
}

function bool(name: string, def: boolean): boolean {
  const raw = String(process.env[name] ?? "").trim().toLowerCase();
  if (!raw) return def;
  return raw === "1" || raw === "true" || raw === "yes";
}

const port = num("PORT", 3000, 1, 65535);

export const cfg = {
  port,
  // URL publique de l'API, utilisée dans les snippets d'intégration.
  publicBaseUrl: str("PUBLIC_BASE_URL", `http://localhost:${port}`),
  // CORS : vide = reflète toutes les origines (dev). En prod, listez vos domaines.
  corsOrigins: list("CORS_ORIGINS"),
  // Sécurité widget : si défini, la création/vérification depuis un navigateur
  // dont l'Origin/Referer n'est pas listé est rejetée (403).
  // En prod, créez les challenges CÔTÉ SERVEUR : ces appels n'ont pas
  // d'Origin et restent autorisés.
  widgetOrigins: list("WIDGET_ALLOWED_ORIGINS"),
  rateMax: num("RATE_LIMIT_MAX", 120, 1, 100000),
  rateWindow: str("RATE_LIMIT_WINDOW", "1 minute"),
  ttlSeconds: num("CHALLENGE_TTL_SECONDS", 120, 15, 3600),
  maxAttempts: num("CHALLENGE_MAX_ATTEMPTS", 3, 1, 10),
  // DEMO_ENABLED=false : la page de démo (/) rend un JSON d'info au lieu du HTML.
  demoEnabled: bool("DEMO_ENABLED", true),
  logLevel: str("LOG_LEVEL", "info"),
  trustProxy: bool("TRUST_PROXY", false),
};
