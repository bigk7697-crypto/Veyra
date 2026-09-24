/* Veyra — fond animé partagé (l'ancien body de l'accueil) :
   réseau de particules plein écran, subtil, sans dépendance.
   Usage : <script src="/bg.js"></script> juste avant </body>. */
(function () {
  if (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  var wrap = document.createElement("div");
  wrap.setAttribute("aria-hidden", "true");
  wrap.style.cssText = "position:fixed;inset:0;z-index:0;overflow:hidden;pointer-events:none;background:#0a0a0b";
  var cv = document.createElement("canvas");
  cv.style.cssText = "position:absolute;inset:0;width:100%;height:100%";
  wrap.appendChild(cv);
  var shade = document.createElement("div");
  shade.style.cssText = "position:absolute;inset:0;background:radial-gradient(1000px 480px at 50% -5%,rgba(139,92,246,.10),transparent),linear-gradient(180deg,rgba(7,8,12,.35),rgba(7,8,12,.12) 40%,rgba(7,8,12,.5))";
  wrap.appendChild(shade);
  document.body.prepend(wrap);
  Array.prototype.forEach.call(document.body.children, function (n) {
    if (n === wrap || n.tagName === "SCRIPT" || n.tagName === "STYLE") return;
    var cs = getComputedStyle(n);
    if (cs.position === "static") { n.style.position = "relative"; n.style.zIndex = "1"; }
  });
  var ctx = cv.getContext("2d");
  var W, H, pts = [];
  function reset() {
    var d = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth; H = window.innerHeight;
    cv.width = W * d; cv.height = H * d;
    ctx.setTransform(d, 0, 0, d, 0, 0);
    var n = Math.min(90, Math.floor((W * H) / 18000));
    pts = [];
    for (var i = 0; i < n; i++) pts.push({
      x: Math.random() * W, y: Math.random() * H,
      vx: (Math.random() - 0.5) * 0.3, vy: (Math.random() - 0.5) * 0.3,
      c: Math.random() < 0.7 ? "139,92,246" : "52,211,153"
    });
  }
  function step() {
    ctx.clearRect(0, 0, W, H);
    var i, j, a, b, dx, dy, d2, dist;
    for (i = 0; i < pts.length; i++) {
      a = pts[i]; a.x += a.vx; a.y += a.vy;
      if (a.x < 0 || a.x > W) a.vx *= -1;
      if (a.y < 0 || a.y > H) a.vy *= -1;
    }
    for (i = 0; i < pts.length; i++) for (j = i + 1; j < pts.length; j++) {
      a = pts[i]; b = pts[j]; dx = a.x - b.x; dy = a.y - b.y; d2 = dx * dx + dy * dy;
      if (d2 < 130 * 130) {
        dist = Math.sqrt(d2);
        ctx.strokeStyle = "rgba(139,92,246," + (0.11 * (1 - dist / 130)) + ")";
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
    }
    for (i = 0; i < pts.length; i++) {
      a = pts[i];
      ctx.fillStyle = "rgba(" + a.c + ",.55)";
      ctx.beginPath(); ctx.arc(a.x, a.y, 1.3, 0, 7); ctx.fill();
    }
    requestAnimationFrame(step);
  }
  reset(); step();
  window.addEventListener("resize", reset);
})();
