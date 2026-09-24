/* Veyra widget 1.1 — vanilla JS, aucune dépendance.
   Mode direct (le widget crée le challenge) :
   <script src="https://votre-domaine/widget.js"></script>
   Veyra.challenge({ container: "#security-check", apiBase: "https://votre-domaine", userId: "alice", apiKey: "veyra_...", onSuccess, onFailure });

   Mode serveur (prod recommandé : votre backend crée le challenge) :
   Veyra.mount({ container: "#security-check", apiBase: "https://votre-domaine", challenge: { id, grid, ttlSeconds, instruction }, onSuccess, onFailure });
   // ou Veyra.mount({ ..., challengeId: "<id>" }) — la grille est récupérée via GET /v1/challenges/:id
*/
(function (global) {
  const Veyra = {};

  function el(tag, style) {
    const e = document.createElement(tag);
    if (style) e.setAttribute("style", style);
    return e;
  }

  const F = "font-family:Inter,-apple-system,'Segoe UI',Roboto,sans-serif;";

  function normalize(data) {
    const ttl = data.ttlSeconds || Math.max(1, Math.round((new Date(data.expiresAt).getTime() - Date.now()) / 1000));
    return {
      id: data.id,
      grid: data.grid,
      ttlSeconds: ttl,
      instruction: data.instruction || "Sélectionnez les éléments de votre secret, dans l'ordre.",
    };
  }

  function renderChallenge(container, apiBase, headers, raw, onSuccess, onFailure) {
    const data = normalize(raw);
    container.innerHTML = "";
    const wrap = el("div", F + "background:#131316;border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:20px;max-width:330px;color:#fafafa;box-shadow:0 16px 48px rgba(0,0,0,.45)");
    const head = el("div", "display:flex;align-items:center;justify-content:space-between;margin-bottom:4px");
    const brand = el("div", "display:flex;align-items:center;gap:8px;font-size:11px;font-weight:800;letter-spacing:.18em;color:#e4e4e7");
    brand.innerHTML = "<svg width='16' height='16' viewBox='0 0 24 24' fill='none'><path d='M12 2l8 3v6c0 5-3.5 8.5-8 11-4.5-2.5-8-6-8-11V5l8-3z' stroke='#8b5cf6' stroke-width='2' fill='rgba(139,92,246,.2)'/><path d='M8.5 12l2.5 2.5 4.5-5' stroke='#10b981' stroke-width='2' stroke-linecap='round'/></svg>VEYRA";
    const timer = el("div", "font-size:11px;color:#a1a1aa;border:1px solid rgba(255,255,255,.1);border-radius:999px;padding:4px 10px;font-variant-numeric:tabular-nums");
    head.appendChild(brand); head.appendChild(timer);
    const instr = el("p", "font-size:13px;color:#a1a1aa;margin:10px 0 2px;line-height:1.5"); instr.textContent = data.instruction;
    const count = el("p", "font-size:11px;color:#52525b;margin:0"); count.textContent = "0 sélectionnée";
    const grid = el("div", "display:grid;grid-template-columns:repeat(3,62px);gap:8px;justify-content:center;margin:14px 0 16px");
    const btn = el("button", F + "width:100%;padding:10px;border-radius:10px;border:none;background:#fafafa;color:#09090b;font-weight:600;font-size:14px;cursor:pointer");
    btn.textContent = "Valider";
    const msg = el("p", "font-size:12px;min-height:18px;margin:10px 0 0;line-height:1.5");
    wrap.appendChild(head); wrap.appendChild(instr); wrap.appendChild(count); wrap.appendChild(grid); wrap.appendChild(btn); wrap.appendChild(msg);
    container.appendChild(wrap);

    const deadline = Date.now() + data.ttlSeconds * 1000;
    const tick = setInterval(() => {
      const left = Math.max(0, Math.round((deadline - Date.now()) / 1000));
      timer.textContent = left > 0 ? left + " s" : "Expiré";
      if (left <= 0) { clearInterval(tick); btn.disabled = true; btn.style.opacity = ".5"; }
    }, 1000);
    timer.textContent = data.ttlSeconds + " s";

    const selections = [];
    const times = [];
    const start = Date.now();
    let corrections = 0;

    data.grid.forEach((cell) => {
      const b = el("button", F + "width:62px;height:62px;font-size:21px;font-weight:700;border-radius:12px;border:1px solid rgba(255,255,255,.08);cursor:pointer;background:" + cell.colorHex + ";color:#111;position:relative;transition:transform .08s");
      b.innerHTML = cell.letter + "<span style='position:absolute;right:5px;top:3px;font-size:11px;opacity:.7'>" + (cell.mark || "") + "</span>";
      b.onmouseenter = () => { b.style.transform = "translateY(-2px)"; };
      b.onmouseleave = () => { b.style.transform = "none"; };
      b.onclick = () => {
        times.push(Date.now());
        const i = selections.indexOf(cell.index);
        if (i >= 0) { selections.splice(i, 1); corrections++; b.style.boxShadow = "none"; b.style.outline = "none"; }
        else { selections.push(cell.index); b.style.outline = "2px solid #fafafa"; b.style.outlineOffset = "2px"; }
        count.textContent = selections.length + " sélectionnée" + (selections.length > 1 ? "s" : "");
      };
      grid.appendChild(b);
    });

    btn.onmouseenter = () => { if (!btn.disabled) btn.style.background = "#e4e4e7"; };
    btn.onmouseleave = () => { btn.style.background = "#fafafa"; };
    btn.onclick = async () => {
      btn.disabled = true;
      btn.textContent = "Vérification…";
      const durationMs = Date.now() - start;
      let avgIntervalMs;
      if (times.length > 1) {
        let sum = 0;
        for (let i = 1; i < times.length; i++) sum += times[i] - times[i - 1];
        avgIntervalMs = sum / (times.length - 1);
      }
      let out;
      try {
        const v = await fetch(apiBase + "/v1/challenges/" + data.id + "/verify", {
          method: "POST",
          headers,
          body: JSON.stringify({ selections, durationMs, corrections, avgIntervalMs }),
        });
        out = await v.json();
        if (!v.ok) throw new Error(out.error || v.status);
      } catch (e) {
        msg.textContent = "Erreur : " + String(e.message || e);
        msg.style.color = "#f87171";
        btn.disabled = false;
        btn.textContent = "Valider";
        onFailure({ error: String(e.message || e) });
        return;
      }
      if (out.verified) {
        clearInterval(tick);
        msg.textContent = "Vérifié · risque " + out.risk_level + " (" + out.risk_score + ")";
        msg.style.color = "#34d399";
        btn.textContent = "Vérifié";
        onSuccess({ sessionId: data.id, ...out });
      } else {
        btn.disabled = false;
        btn.textContent = "Valider";
        msg.textContent = "Manqué · risque " + out.risk_level + " (" + out.risk_score + ") → " + out.next_action
          + (out.attemptsLeft !== undefined ? " · " + out.attemptsLeft + " essai(s)" : "");
        msg.style.color = "#f87171";
        onFailure({ sessionId: data.id, ...out });
      }
    };
  }

  function baseOpts(opts) {
    const container = typeof opts.container === "string" ? document.querySelector(opts.container) : opts.container;
    if (!container) throw new Error("Veyra: container introuvable");
    const apiBase = (opts.apiBase || "").replace(/\/$/, "");
    const onSuccess = opts.onSuccess || function () {};
    const onFailure = opts.onFailure || function () {};
    const headers = { "Content-Type": "application/json" };
    if (opts.apiKey) headers["X-API-Key"] = opts.apiKey;
    return { container, apiBase, onSuccess, onFailure, headers };
  }

  Veyra.challenge = async function (opts) {
    if (!opts.userId) throw new Error("Veyra: userId requis (enroll d'abord)");
    const { container, apiBase, onSuccess, onFailure, headers } = baseOpts(opts);
    container.innerHTML = "<p style='" + F + "color:#71717a;font-size:13px'>Chargement de la vérification…</p>";
    try {
      const res = await fetch(apiBase + "/v1/challenges", {
        method: "POST",
        headers,
        body: JSON.stringify({ userId: opts.userId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.status);
      renderChallenge(container, apiBase, headers, data, onSuccess, onFailure);
    } catch (e) {
      container.innerHTML = "<p style='" + F + "color:#f87171;font-size:13px'>Échec du challenge : " + String(e.message || e) + "</p>";
      onFailure({ error: String(e.message || e) });
    }
  };

  Veyra.mount = async function (opts) {
    const { container, apiBase, onSuccess, onFailure, headers } = baseOpts(opts);
    container.innerHTML = "<p style='" + F + "color:#71717a;font-size:13px'>Chargement de la vérification…</p>";
    try {
      if (opts.challenge && opts.challenge.grid) {
        renderChallenge(container, apiBase, headers, opts.challenge, onSuccess, onFailure);
        return;
      }
      if (!opts.challengeId) throw new Error("Veyra: challenge ou challengeId requis");
      const res = await fetch(apiBase + "/v1/challenges/" + opts.challengeId, { headers });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.status);
      renderChallenge(container, apiBase, headers, { id: opts.challengeId, ...data }, onSuccess, onFailure);
    } catch (e) {
      container.innerHTML = "<p style='" + F + "color:#f87171;font-size:13px'>Échec du challenge : " + String(e.message || e) + "</p>";
      onFailure({ error: String(e.message || e) });
    }
  };

  global.Veyra = Veyra;
})(window);
