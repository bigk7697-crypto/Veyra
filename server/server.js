// Entrée serverless Vercel (voir vercel.json à la racine : /v1/* et /health
// sont réécrits vers cette fonction). Le build `npm run build` génère dist/.
let appPromise = null;

module.exports = async (req, res) => {
  try {
    if (!appPromise) {
      const { buildApp } = require("./dist/index.js");
      appPromise = buildApp().then(async (app) => {
        await app.ready();
        return app;
      });
    }
    const app = await appPromise;
    app.server.emit("request", req, res);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    if (!res.headersSent) res.statusCode = 500;
    res.end(JSON.stringify({ error: "internal error" }));
  }
};
