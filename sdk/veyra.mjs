/* Helpers serveur Veyra — zéro dépendance (Node 18+, fetch natif).
   import { createClient, requireVeyraSession } from "./sdk/veyra.mjs";
*/
export function createClient({ baseUrl, apiKey }) {
  const base = String(baseUrl || "").replace(/\/$/, "");
  if (!base) throw new Error("Veyra: baseUrl requise");
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["X-API-Key"] = apiKey;

  async function call(path, options = {}) {
    const res = await fetch(base + path, { headers, ...options });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(`Veyra ${options.method || "GET"} ${path}: ${body.error || res.status}`);
      err.status = res.status;
      err.body = body;
      throw err;
    }
    return body;
  }

  return {
    /** Enroll (une fois par utilisateur). */
    enroll: ({ userId, secretWord, color, motif }) =>
      call("/v1/enroll", { method: "POST", body: JSON.stringify({ userId, secretWord, color, motif }) }),

    /** Crée un challenge côté serveur. Retourne { id, grid, ttlSeconds, expiresAt, instruction }. */
    createChallenge: (userId) =>
      call("/v1/challenges", { method: "POST", body: JSON.stringify({ userId }) }),

    /** Récupère la grille d'un challenge (si le frontend ne reçoit que l'id). */
    getChallenge: (id) => call(`/v1/challenges/${id}`),

    /** Vérifie une réponse (si vous ne passez pas par le widget). */
    verify: (id, { selections, durationMs = 0, corrections = 0, avgIntervalMs } = {}) =>
      call(`/v1/challenges/${id}/verify`, {
        method: "POST",
        body: JSON.stringify({ selections, durationMs, corrections, avgIntervalMs }),
      }),

    /** Lit la décision d'une session (à appeler depuis votre backend, jamais le frontend seul). */
    getRisk: (sessionId) => call(`/v1/security/risk/${sessionId}`),

    /** Émet un événement custom visible dans le dashboard. */
    sendEvent: (event) => call("/v1/events", { method: "POST", body: JSON.stringify(event) }),
  };
}

/**
 * Garde à appeler dans votre route sensible (ex: POST /api/login) avec le
 * sessionId renvoyé par le widget (onSuccess → r.sessionId).
 * Retourne { verified, risk_score, risk_level, next_action }.
 */
export async function requireVeyraSession(client, sessionId) {
  if (!sessionId) {
    const err = new Error("Veyra: sessionId manquant");
    err.status = 401;
    throw err;
  }
  return client.getRisk(sessionId);
}

/**
 * Mini-middleware Express : protège une route par session Veyra.
 * Le client envoie { veyraSession } dans le body JSON.
 *
 * app.post("/api/login", veyraGuard(client), (req, res) => { ... });
 * // req.veyra = { verified, risk_score, risk_level, next_action }
 */
export function veyraGuard(client, { sessionField = "veyraSession" } = {}) {
  return async (req, res, next) => {
    try {
      const sessionId = req.body?.[sessionField];
      const decision = await requireVeyraSession(client, sessionId);
      if (!decision.verified) return res.status(403).json({ error: "Vérification Veyra requise", decision });
      req.veyra = decision;
      next();
    } catch (err) {
      return res.status(err.status || 500).json({ error: err.message });
    }
  };
}
