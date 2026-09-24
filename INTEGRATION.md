# Veyra — Guide d'intégration production

Veyra est une **API de décision de sécurité** + un **widget de challenge**.
Vos utilisateurs prouvent qu'ils ne sont pas des bots ; votre backend applique la décision.

```
Votre frontend  →  Votre backend  →  API Veyra  →  { verified, risk_score, next_action }
```

> La page de démo (`/`) et le dashboard (`/dashboard.html`) sont des outils.
> En production, vos apps appellent l'API et embarquent `widget.js`.

---

## 1. Déployer Veyra

**Option A — Node direct**

```bash
cd api
cp .env.example .env   # ajustez PUBLIC_BASE_URL, CORS_ORIGINS, VEYRA_MASTER_KEY…
npm install
npm run build
npm start              # écoute sur PORT (3000 par défaut)
```

**Option B — Docker**

```bash
docker compose up --build -d
```

Persistance : SQLite dans `api/data/` (monté en volume dans compose).
Sauvegardez ce dossier, ainsi que `VEYRA_MASTER_KEY` (sans elle, les secrets
enrollés deviennent illisibles après redéploiement).

## 2. Configurer (`.env`)

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` | `3000` | Port d'écoute |
| `PUBLIC_BASE_URL` | `http://localhost:PORT` | URL publique (snippets, widget) |
| `CORS_ORIGINS` | vide (= ouvert) | Domaines frontend autorisés |
| `WIDGET_ALLOWED_ORIGINS` | vide (= ouvert) | Origines navigateur autorisées pour le widget |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW` | `120` / `1 minute` | Rate limit global par IP |
| `CHALLENGE_TTL_SECONDS` | `120` | Durée de vie d'un challenge |
| `CHALLENGE_MAX_ATTEMPTS` | `3` | Essais avant blocage (`require_mfa`) |
| `DEMO_ENABLED` | `true` | Page démo sur `/` (`false` = JSON d'info) |
| `VEYRA_MASTER_KEY` | auto (`data/master.key`) | Clé AES des secrets — **fixez-la en prod** |
| `LOG_LEVEL` / `TRUST_PROXY` | `info` / `0` | Logs ; `1` derrière nginx/Caddy |

## 3. Intégrer à votre projet (prod recommandé)

**Étape 1 — Enroller chaque utilisateur (une fois, côté serveur) :**

```bash
curl -s -X POST $VEYRA/v1/enroll \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $KEY" \
  -d '{"userId":"alice","secretWord":"TIGRE","color":"violet","motif":"etoile"}'
```

**Étape 2 — Créer le challenge côté serveur** (le secret ne touche jamais le frontend) :

```bash
curl -s -X POST $VEYRA/v1/challenges \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $KEY" \
  -d '{"userId":"alice"}'
# → { id, grid, ttlSeconds, expiresAt, instruction }
```

**Étape 3 — Afficher avec le widget en mode `mount` :**

```html
<script src="https://veyra.example.com/widget.js"></script>
<script>
Veyra.mount({
  container: "#security-check",
  apiBase: "https://veyra.example.com",
  challenge: CHALLENGE_JSON_FROM_YOUR_BACKEND, // ou challengeId: "<id>"
  onSuccess: (r) => fetch("/api/login", {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ user: "alice", veyraSession: r.sessionId })
  }),
  onFailure: (r) => console.log(r.next_action) // retry | require_mfa
});
</script>
```

**Étape 4 — Vérifier la session côté serveur** (ne faites jamais confiance au frontend seul) :

```bash
curl -s $VEYRA/v1/security/risk/<sessionId> -H "X-API-Key: $KEY"
# → { verified, risk_score, risk_level, next_action }
```

`verified:false` → refusez. `next_action:require_mfa` → exigez votre MFA.
Le `risk_score` est un **signal**, pas une preuve : logguez-le, ne bannissez pas dessus.

**Mode simple** (challenge créé par le widget) : `Veyra.challenge({ userId })`
— OK pour démarrer, moins strict (réservé aux origines listées via
`WIDGET_ALLOWED_ORIGINS`, sinon créez côté serveur).

## 4. SDK Node zéro-dépendance (`sdk/veyra.mjs`)

```js
import { createClient, requireVeyraSession } from "./sdk/veyra.mjs";
const veyra = createClient({ baseUrl: process.env.VEYRA_URL, apiKey: process.env.VEYRA_KEY });

await veyra.enroll({ userId: "alice", secretWord: "TIGRE", color: "violet", motif: "etoile" });
const challenge = await veyra.createChallenge("alice"); // → à passer au frontend
// … après onSuccess côté client, le frontend renvoie sessionId :
const decision = await requireVeyraSession(veyra, sessionId);
if (!decision.verified) throw new Error("accès refusé");
if (decision.next_action === "require_mfa") { /* votre MFA */ }
```

## 5. Clés API et exploitation

- Créez une clé par application cliente : dashboard → **Clés API → Créer**
  (secret affiché **une seule fois**), ou `POST /v1/keys`.
- Envoyez-la dans le header `X-API-Key`. Tant qu'aucune clé n'existe,
  l'API reste ouverte (mode bootstrap) — créez-en une dès le départ en prod.
- Pilotez tout depuis `/dashboard.html` : stats, événements, révocation.

## 6. Checklist production

- [ ] `VEYRA_MASTER_KEY` fixée + `api/data/` persisté et sauvegardé
- [ ] HTTPS devant l'API (reverse proxy), `TRUST_PROXY=1`
- [ ] `CORS_ORIGINS` + `WIDGET_ALLOWED_ORIGINS` restreints à vos domaines
- [ ] Au moins une clé API créée, `DEMO_ENABLED=false`
- [ ] Challenges créés et sessions vérifiées **côté serveur**
- [ ] `docker compose up --build -d`, healthcheck sur `GET /health`
