// api/auto-calculate-scores.js — VERSION FINALE SIMPLE
export const config = { runtime: "edge" };

const SECRET = "go2026admin";
const KV  = () => process.env.KV_REST_API_URL;
const TOK = () => process.env.KV_REST_API_TOKEN;

// Points F1 reels par position
const PTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];

// Vrais resultats GP Autriche 2026 — index 0 = P1, index 1 = P2, etc.
const RESULTS = ["Russell","Verstappen","Antonelli","Piastri","Hamilton","Hadjar","Norris","Leclerc","Lawson","Lindblad"];

async function get(k) {
  const r = await fetch(`${KV()}/get/${encodeURIComponent(k)}`, {
    headers: { Authorization: `Bearer ${TOK()}` },
  });
  return (await r.json()).result ?? null;
}

async function set(k, v) {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  await fetch(`${KV()}/set/${encodeURIComponent(k)}/${encodeURIComponent(s)}`, {
    headers: { Authorization: `Bearer ${TOK()}` },
  });
}

// Scan toutes les cles qui matchent un pattern
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

// Parse profil — gere simple ET double serialisation legacy
function parseProfile(raw) {
  try {
    let p = JSON.parse(raw);
    if (typeof p === "string") p = JSON.parse(p);
    return p;
  } catch {
    return null;
  }
}

// Calcul des points pour un joueur
// pred = [{sn:"Russell", n:"63", tc:"..."}, ...] — format save-prediction.js
// Le joueur predit la position : pred[0] = son choix pour P1, pred[1] pour P2, etc.
// Si pred[i].sn === RESULTS[i] => bonne prediction => PTS[i] points
function calcPoints(pred, plan) {
  const max = (plan === "premium" || plan === "creator") ? 10 : 5;
  let total = 0;
  const detail = [];

  for (let i = 0; i < Math.min(max, RESULTS.length, pred.length); i++) {
    const item = pred[i];
    // Gere les deux formats : string ou objet {sn}
    const sn = typeof item === "string" ? item.trim() : (item?.sn || "").trim();
    if (!sn) continue;

    const correct = sn.toLowerCase() === RESULTS[i].toLowerCase();
    const pts = correct ? PTS[i] : 0;
    total += pts;
    detail.push({ pos: i + 1, predicted: sn, actual: RESULTS[i], correct, pts });
  }

  return { total, detail };
}

export default async function handler(req) {
  const url = new URL(req.url);

  // Auth
  if (url.searchParams.get("secret") !== SECRET && req.headers.get("x-vercel-cron") !== "1") {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { "Content-Type": "application/json" },
    });
  }

  const force = url.searchParams.get("force") === "1";
  const gpId  = "austria-2026";

  // Si deja calcule avec le bon classement, skip (sauf force=1)
  if (!force) {
    const done = await get("config:scores_done:" + gpId);
    if (done) {
      const d = JSON.parse(done);
      if (d.updated > 0 && d.results && d.results[0] === RESULTS[0]) {
        return new Response(JSON.stringify({
          success: true, skipped: true,
          message: "Deja calcule - " + d.updated + " joueurs - utilisez force=1 pour recalculer",
          results: RESULTS,
        }), { headers: { "Content-Type": "application/json" } });
      }
    }
  }

  // Scan TOUTES les cles pred:* puis filtre en JS
  // (le pattern pred:*:gpId rate les emails avec @ dans Upstash)
  const allKeys = await scan("pred:*");
  const gpKeys = allKeys.filter(k => k.endsWith(":" + gpId) || k.endsWith(":gp-r10-2026"));

  // Dedoublonne par email
  const seen = new Set();
  const keys = gpKeys.filter(k => {
    const email = k.split(":").slice(1, -1).join(":");
    if (seen.has(email)) return false;
    seen.add(email);
    return true;
  });

  if (!keys.length) {
    return new Response(JSON.stringify({
      success: false,
      message: "Aucune prediction trouvee pour " + gpId,
      totalKeys: allKeys.length,
      gpKeys: gpKeys.length,
    }), { headers: { "Content-Type": "application/json" } });
  }

  // Calcul pour chaque joueur
  let updated = 0, totalPts = 0;
  const updatedProfiles = new Map();
  const details = [];

  await Promise.allSettled(keys.map(async (key) => {
    try {
      const email = key.split(":").slice(1, -1).join(":");
      if (!email) return;

      // Lire la prediction
      const predRaw = await get(key);
      if (!predRaw) return;
      const pred = JSON.parse(predRaw);
      if (!Array.isArray(pred) || !pred.length) return;

      // Lire le profil
      const profileRaw = await get("profile:" + email.toLowerCase());
      if (!profileRaw) return;
      const profile = parseProfile(profileRaw);
      if (!profile) return;

      // Calculer les points
      const { total: gpPts, detail } = calcPoints(pred, profile.plan || "free");

      // Soustraire anciens points de ce GP si recalcul
      const oldPts = profile.gpHistory?.[gpId]?.pts || 0;
      profile.points = Math.max(0, (profile.points || 0) - oldPts + gpPts);

      // Sauvegarder historique
      if (!profile.gpHistory) profile.gpHistory = {};
      profile.gpHistory[gpId] = {
        pts: gpPts,
        pred: pred.map(p => typeof p === "string" ? p : (p?.sn || "")),
        results: RESULTS,
        detail,
        ts: Date.now(),
      };

      await set("profile:" + email.toLowerCase(), JSON.stringify(profile));
      updatedProfiles.set(email.toLowerCase(), profile);
      updated++;
      totalPts += gpPts;
      details.push({ handle: profile.handle || email, gpPts, total: profile.points, detail });
    } catch {}
  }));

  // Sync ligues
  let leaguesUpdated = 0;
  for (const [email, profile] of updatedProfiles) {
    try {
      const lidsRaw = await get("user:" + profile.handle + ":leagues");
      if (!lidsRaw) continue;
      const lids = JSON.parse(lidsRaw);
      for (const lid of lids) {
        const mRaw = await get("league:" + lid + ":members");
        if (!mRaw) continue;
        const members = JSON.parse(mRaw);
        const idx = members.findIndex(m => m.email === email || m.handle === profile.handle);
        if (idx < 0) continue;
        members[idx].pts = profile.points || 0;
        await set("league:" + lid + ":members", members);
        leaguesUpdated++;
      }
    } catch {}
  }

  // Rebuild classement WDC
  let ranked = 0;
  try {
    const profileKeys = await scan("profile:*");
    const profiles = await Promise.all(profileKeys.map(async k => {
      try {
        const raw = await get(k);
        if (!raw) return null;
        const p = parseProfile(raw);
        if (!p) return null;
        const fresh = updatedProfiles.get(p.email?.toLowerCase());
        if (fresh) p.points = fresh.points;
        return p.email || p.handle ? p : null;
      } catch { return null; }
    }));

    const wdc = profiles
      .filter(Boolean)
      .map(p => ({
        handle: p.handle || p.email?.split("@")[0] || "Anonyme",
        email: p.email || "",
        points: p.points || 0,
        plan: p.plan || "free",
        gpHistory: p.gpHistory || {},
      }))
      .sort((a, b) => b.points - a.points)
      .map((p, i) => ({ ...p, rank: i + 1 }));

    await set("config:wdc_standings", JSON.stringify(wdc));
    ranked = wdc.length;
  } catch {}

  // Marquer comme calcule
  if (updated > 0) {
    await set("config:scores_done:" + gpId, JSON.stringify({
      ts: Date.now(), results: RESULTS, updated,
    }));
  }

  return new Response(JSON.stringify({
    success: true,
    gpId,
    results: RESULTS,
    updated,
    avgPts: updated ? Math.round(totalPts / updated) : 0,
    leaguesUpdated,
    ranked,
    top5: details.sort((a, b) => b.gpPts - a.gpPts).slice(0, 5),
    message: updated + " joueurs mis a jour - " + leaguesUpdated + " ligues - " + ranked + " classes",
  }), { headers: { "Content-Type": "application/json" } });
}
