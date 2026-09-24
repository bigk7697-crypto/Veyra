/* Seed fonctionnel Veyra : crée le user démo via la vraie API. Usage: node seed.mjs [apiBase] */
const base = (process.argv[2] || "http://localhost:3000").replace(/\/$/, "");

async function post(path, body, key) {
  const headers = { "Content-Type": "application/json" };
  if (key) headers["X-API-Key"] = key;
  const r = await fetch(base + path, { method: "POST", headers, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${path} ${r.status} ${JSON.stringify(j)}`);
  return j;
}

const key = process.env.VEYRA_API_KEY || "";
const user = await post("/v1/enroll", { userId: "demo-tigre", secretWord: "TIGRE", color: "violet", motif: "etoile" }, key || undefined);
console.log("Seed OK:", JSON.stringify(user));
console.log("Ouvrez " + base + "/ pour la démo login, " + base + "/dashboard.html pour le dashboard.");
