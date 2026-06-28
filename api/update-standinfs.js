// api/update-standings.js
// Reconstruit config:wdc_standings depuis tous les profils
// et rafraichit les ligues
// GET ?secret=go2026admin
export const config = { runtime: "edge" };

const ADMIN_SECRET = "go2026admin";
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

async function kvScan(pattern) {
  let cursor = "0";
  let allKeys = [];
  do {
    const r = await fetch(
      `${KV()}/scan/${cursor}/match/${encodeURIComponent(pattern)}/count/500`,
      { headers: { Authorization: `Bearer ${TOK()}` } }
    );
    const d = await r.json();
    const [nc, keys] = d.result || ["0", []];
    cursor = nc;
    allKeys.push(...(keys || []));
  } while (cursor !== "0");
  return allKeys;
}

export default async function handler(req) {
  const url = new URL(req.url);
  const isCron    = req.headers.get("x-vercel-cron") === "1";
  const isInternal = req.headers.get("x-internal-call") === "go2026";

  if (!isCron && !isInternal && url.searchParams.get("secret") !== ADMIN_SECRET) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 1. Scan tous les profils
  const profileKeys = await kvScan("profile:*");
  if (!profileKeys.length) {
    return new Response(JSON.stringify({ success: false, message: "Aucun profil trouve" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // 2. Lire tous les profils en parallele
  const profiles = await Promise.all(
    profileKeys.map(async (key) => {
      try {
        const raw = await kvGet(key);
        if (!raw) return null;
        const p = JSON.parse(raw);
        if (!p.email && !p.handle) return null;
        return p;
      } catch {
        return null;
      }
    })
  );

  const validProfiles = profiles.filter(Boolean);

  // 3. Construire le classement WDC
  const wdc = validProfiles
    .map((p) => ({
      handle    : p.handle || (p.email ? p.email.split("@")[0] : "Anonyme"),
      email     : p.email || "",
      points    : p.points || 0,
      plan      : p.plan || "free",
      avatar    : p.avatar || null,
      gpHistory : p.gpHistory || {},
      gpsPlayed : Object.keys(p.gpHistory || {}).length,
    }))
    .sort((a, b) => b.points - a.points)
    .map((p, i) => ({ ...p, rank: i + 1 }));

  // 4. Sauvegarder le classement
  await kvSet("config:wdc_standings", JSON.stringify(wdc));
  await kvSet("config:standings_updated_at", Date.now().toString());

  // 5. Trouver toutes les ligues
  // Methode A : scan direct league:*:members
  let leagueKeys = await kvScan("league:*:members");

  // Methode B : via invite:* si methode A vide
  if (!leagueKeys.length) {
    const inviteKeys = await kvScan("invite:*");
    const leagueIdsSet = new Set();
    await Promise.all(
      inviteKeys.map(async (key) => {
        const raw = await kvGet(key);
        if (raw && typeof raw === "string") leagueIdsSet.add(raw);
      })
    );
    leagueKeys = [...leagueIdsSet].map((id) => `league:${id}:members`);
  }

  // 6. Mettre a jour les points dans chaque ligue
  let leaguesUpdated = 0;

  await Promise.allSettled(
    leagueKeys.map(async (key) => {
      try {
        const mRaw = await kvGet(key);
        if (!mRaw) return;
        const members = JSON.parse(mRaw);
        let changed = false;
        const updated = members.map((m) => {
          const profile = validProfiles.find(
            (p) =>
              p.email?.toLowerCase() === m.email?.toLowerCase() ||
              p.handle === m.handle
          );
          if (profile && (profile.points || 0) !== (m.pts || 0)) {
            changed = true;
            return { ...m, pts: profile.points || 0 };
          }
          return m;
        });
        if (changed) {
          await kvSet(key, JSON.stringify(updated));
          leaguesUpdated++;
        }
      } catch {}
    })
  );

  return new Response(
    JSON.stringify({
      success       : true,
      playersRanked : wdc.length,
      leaguesUpdated,
      topPlayer     : wdc[0] ? `${wdc[0].handle} (${wdc[0].points} pts)` : "N/A",
      message       : `Classement mis a jour - ${wdc.length} joueurs, ${leaguesUpdated} ligues`,
    }),
    { headers: { "Content-Type": "application/json" } }
  );
}
