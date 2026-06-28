// api/reset-gp-scores.js
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

// Parse proprement un profil — gere simple ET double serialisation
function parseProfile(raw) {
  try {
    let p = JSON.parse(raw);
    if (typeof p === "string") p = JSON.parse(p);
    return p;
  } catch {
    return null;
  }
}

export default async function handler(req) {
  const url = new URL(req.url);
  if (url.searchParams.get("secret") !== SECRET) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { "Content-Type": "application/json" },
    });
  }

  const gpId  = url.searchParams.get("gpId") || "austria-2026";
  const all   = url.searchParams.get("all") === "1";

  // Supprimer le flag "deja calcule" pour ce GP
  if (!all) await kvDel("config:scores_done:" + gpId);

  // Scanner tous les profils
  const profileKeys = await scan("profile:*");
  let reset = 0, skipped = 0, errors = 0;
  const log = [];

  await Promise.allSettled(profileKeys.map(async (key) => {
    try {
      const raw = await kvGet(key);
      if (!raw) { skipped++; return; }

      const profile = parseProfile(raw);
      if (!profile) { errors++; return; }

      const before = profile.points || 0;

      if (all) {
        // Remise a zero totale — efface tous les points et tout l historique
        profile.points = 0;
        profile.gpHistory = {};
      } else {
        // Remise a zero pour un seul GP
        const gpPts = profile.gpHistory?.[gpId]?.pts ?? null;
        if (gpPts === null) { skipped++; return; }
        profile.points = Math.max(0, before - gpPts);
        delete profile.gpHistory[gpId];
      }

      await kvSet(key, JSON.stringify(profile));
      log.push({ handle: profile.handle || "", before, after: profile.points });
      reset++;
    } catch {
      errors++;
    }
  }));

  // Rebuild classement WDC
  try {
    const allProfileKeys = await scan("profile:*");
    const profiles = await Promise.all(allProfileKeys.map(async k => {
      const raw = await kvGet(k);
      if (!raw) return null;
      const p = parseProfile(raw);
      return p && (p.email || p.handle) ? p : null;
    }));
    const wdc = profiles.filter(Boolean)
      .map(p => ({ handle: p.handle || p.email?.split("@")[0] || "Anonyme", email: p.email || "", points: p.points || 0 }))
      .sort((a, b) => b.points - a.points)
      .map((p, i) => ({ ...p, rank: i + 1 }));
    await kvSet("config:wdc_standings", JSON.stringify(wdc));
  } catch {}

  return new Response(JSON.stringify({
    success: true,
    gpId: all ? "ALL" : gpId,
    reset,
    skipped,
    errors,
    log,
    message: reset + " joueurs remis a zero" + (all ? " (total)" : " pour " + gpId),
  }), { headers: { "Content-Type": "application/json" } });
}
