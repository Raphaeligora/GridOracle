// api/reset-gp-scores.js
// Remet les points de ce GP a zero pour tous les joueurs
// A appeler UNE SEULE FOIS avant auto-calculate-scores
// GET ?secret=go2026admin&gpId=austria-2026
export const config = { runtime: "edge" };

const SECRET = "go2026admin";
const KV  = () => process.env.KV_REST_API_URL;
const TOK = () => process.env.KV_REST_API_TOKEN;

async function kvGet(k) {
  const r = await fetch(`${KV()}/get/${encodeURIComponent(k)}`, {
    headers: { Authorization: `Bearer ${TOK()}` },
  });
  return (await r.json()).result ?? null;
}

async function kvSet(k, v) {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  await fetch(`${KV()}/set/${encodeURIComponent(k)}/${encodeURIComponent(s)}`, {
    headers: { Authorization: `Bearer ${TOK()}` },
  });
}

async function kvDel(k) {
  await fetch(`${KV()}/del/${encodeURIComponent(k)}`, {
    headers: { Authorization: `Bearer ${TOK()}` },
  });
}

async function scan(pattern) {
  let cursor = "0", keys = [];
  do {
    const r = await fetch(
      `${KV()}/scan/${cursor}/match/${encodeURIComponent(pattern)}/count/500`,
      { headers: { Authorization: `Bearer ${TOK()}` } }
    );
    const d = await r.json();
    const [nc, batch] = d.result || ["0", []];
    cursor = nc;
    keys.push(...(batch || []));
  } while (cursor !== "0");
  return keys;
}

export default async function handler(req) {
  const url = new URL(req.url);

  if (url.searchParams.get("secret") !== SECRET) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { "Content-Type": "application/json" },
    });
  }

  const gpId = url.searchParams.get("gpId") || "austria-2026";

  // 1. Supprimer le flag "deja calcule" pour ce GP
  await kvDel("config:scores_done:" + gpId);

  // 2. Scanner tous les profils
  const profileKeys = await scan("profile:*");
  let reset = 0, skipped = 0;

  await Promise.allSettled(profileKeys.map(async (key) => {
    try {
      const raw = await kvGet(key);
      if (!raw) return;

      let profile = JSON.parse(raw);
      if (typeof profile === "string") profile = JSON.parse(profile);

      // Ce joueur a-t-il des points pour ce GP ?
      const gpPts = profile.gpHistory?.[gpId]?.pts;
      if (gpPts === undefined) { skipped++; return; }

      // Soustraire les points de ce GP
      profile.points = Math.max(0, (profile.points || 0) - gpPts);

      // Supprimer l historique de ce GP
      delete profile.gpHistory[gpId];

      await kvSet(key, profile);
      reset++;
    } catch {}
  }));

  return new Response(JSON.stringify({
    success: true,
    gpId,
    reset,
    skipped,
    message: reset + " joueurs remis a zero pour " + gpId + " - relancez auto-calculate-scores?force=1",
  }), { headers: { "Content-Type": "application/json" } });
}
