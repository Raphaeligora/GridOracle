// api/auto-calculate-scores.js — v5 FINAL
// Systeme complet : calcul points + classement + ligues
// Double quotes uniquement, zero accent dans les strings
export const config = { runtime: "edge" };

const ADMIN_SECRET = "go2026admin";
const F1_PTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
const KV  = () => process.env.KV_REST_API_URL;
const TOK = () => process.env.KV_REST_API_TOKEN;

// ── KV helpers ──────────────────────────────────────────────────────────────
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

// Scan LARGE puis filtre en JS — evite le bug @ dans les emails
async function kvScanAll(pattern) {
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

// ── Resultats connus par GP ──────────────────────────────────────────────────
// Format : tableau de sn dans l ordre (P1 a P10)
// sn = valeur stockee dans les predictions des joueurs
const RACE_RESULTS = {
  "austria-2026": ["Russell", "Verstappen", "Antonelli", "Piastri", "Hamilton", "Hadjar", "Norris", "Leclerc", "Lawson", "Lindblad"],
};

// ── Calcul des points ────────────────────────────────────────────────────────
// Regle : prediction[i] = pilote predit en position (i+1)
//         results[i]    = pilote ayant termine en position (i+1) selon les vrais resultats F1
// Si prediction[i].sn === results[i] => le joueur a predit ce pilote A LA BONNE POSITION
// => il recoit les points F1 reels de cette position (25/18/15/12/10/8/6/4/2/1)
// Free  : 5 pilotes a predire (positions P1-P5)
// Premium/Creator : 10 pilotes a predire (positions P1-P10)
function calcPts(prediction, results, plan) {
  const maxPos = (plan === "premium" || plan === "creator") ? 10 : 5;
  let pts = 0;
  for (let i = 0; i < Math.min(maxPos, results.length, prediction.length); i++) {
    // Extrait le sn du joueur pour cette position
    const raw = prediction[i];
    const sn = (typeof raw === "string" ? raw : (raw && raw.sn ? raw.sn : "")).trim();
    if (!sn) continue;
    // Compare avec le vrai resultat a cette position
    if (sn.toLowerCase() === results[i].toLowerCase()) {
      // Bonne position : points F1 reels de cette place
      pts += F1_PTS[i] || 0;
    }
    // Mauvaise position = 0 pts pour ce slot
  }
  return pts;
}

// ── Debug : detail du calcul pour un joueur ──────────────────────────────────
function calcPtsDetail(prediction, results, plan) {
  const maxPos = (plan === "premium" || plan === "creator") ? 10 : 5;
  const detail = [];
  let total = 0;
  for (let i = 0; i < Math.min(maxPos, results.length, prediction.length); i++) {
    const raw = prediction[i];
    const sn = (typeof raw === "string" ? raw : (raw && raw.sn ? raw.sn : "")).trim();
    if (!sn) continue;
    const correct = sn.toLowerCase() === results[i].toLowerCase();
    const ptsEarned = correct ? (F1_PTS[i] || 0) : 0;
    total += ptsEarned;
    detail.push({
      pos      : i + 1,
      predicted: sn,
      actual   : results[i],
      correct,
      pts      : ptsEarned,
    });
  }
  return { total, detail };
}

// ── Sync ligues depuis user:handle:leagues ───────────────────────────────────
async function syncLeagues(updatedProfiles) {
  let leaguesUpdated = 0;

  // Methode A : via user:handle:leagues
  for (const [email, profile] of updatedProfiles) {
    try {
      const lidsRaw = await kvGet(`user:${profile.handle}:leagues`);
      if (!lidsRaw) continue;
      const lids = JSON.parse(lidsRaw);
      await Promise.allSettled(lids.map(async (lid) => {
        const mRaw = await kvGet(`league:${lid}:members`);
        if (!mRaw) return;
        const members = JSON.parse(mRaw);
        const idx = members.findIndex(
          (m) => m.email === email || m.handle === profile.handle
        );
        if (idx < 0) return;
        if (members[idx].pts !== (profile.points || 0)) {
          members[idx].pts = profile.points || 0;
          await kvSet(`league:${lid}:members`, members);
          leaguesUpdated++;
        }
      }));
    } catch {}
  }

  // Methode B : scan league:*:members en complement
  try {
    const leagueKeys = await kvScanAll("league:*:members");
    await Promise.allSettled(leagueKeys.map(async (key) => {
      try {
        const mRaw = await kvGet(key);
        if (!mRaw) return;
        const members = JSON.parse(mRaw);
        let changed = false;
        const updated = members.map((m) => {
          const profile = updatedProfiles.get(m.email?.toLowerCase());
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
    }));
  } catch {}

  return leaguesUpdated;
}

// ── Reconstruction du classement WDC ────────────────────────────────────────
async function rebuildStandings(updatedProfiles) {
  try {
    const profileKeys = await kvScanAll("profile:*");
    const profiles = await Promise.all(
      profileKeys.map(async (key) => {
        try {
          const raw = await kvGet(key);
          if (!raw) return null;
          const p = JSON.parse(raw);
          // Prendre les points mis a jour si ce profil vient d etre modifie
          const fresh = updatedProfiles.get(p.email?.toLowerCase());
          if (fresh) p.points = fresh.points;
          if (!p.email && !p.handle) return null;
          return p;
        } catch { return null; }
      })
    );

    const wdc = profiles
      .filter(Boolean)
      .map((p) => ({
        handle    : p.handle || (p.email ? p.email.split("@")[0] : "Anonyme"),
        email     : p.email || "",
        points    : p.points || 0,
        plan      : p.plan || "free",
        gpHistory : p.gpHistory || {},
        gpsPlayed : Object.keys(p.gpHistory || {}).length,
      }))
      .sort((a, b) => b.points - a.points)
      .map((p, i) => ({ ...p, rank: i + 1 }));

    await kvSet("config:wdc_standings", JSON.stringify(wdc));
    await kvSet("config:standings_updated_at", Date.now().toString());
    return wdc.length;
  } catch {
    return 0;
  }
}

// ── Handler principal ────────────────────────────────────────────────────────
export default async function handler(req) {
  const url   = new URL(req.url);
  const isCron = req.headers.get("x-vercel-cron") === "1";

  // Auth
  if (!isCron && url.searchParams.get("secret") !== ADMIN_SECRET) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const force  = url.searchParams.get("force") === "1";
  const gpId   = url.searchParams.get("gpId") || "austria-2026";
  const debug  = url.searchParams.get("debug") === "1";

  // Resultats du GP
  const results = RACE_RESULTS[gpId];
  if (!results || !results.length) {
    return new Response(
      JSON.stringify({ success: false, message: "Pas de resultats connus pour " + gpId }),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  // Verifier si deja calcule
  const doneRaw = await kvGet("config:scores_done:" + gpId);
  if (doneRaw && !force) {
    const done = JSON.parse(doneRaw);
    // Verifier que le classement stocke correspond au classement actuel connu
    const storedResults = (done.results || []).join(",");
    const currentResults = results.join(",");
    if (done.updated > 0 && storedResults === currentResults) {
      return new Response(
        JSON.stringify({ success: true, skipped: true, message: "Deja calcule : " + done.updated + " joueurs", results }),
        { headers: { "Content-Type": "application/json" } }
      );
    }
    // Classement different ou updated=0 = on recalcule
  }

  // ── Scan TOUTES les predictions (pred:*) puis filtre en JS ──
  // IMPORTANT : le pattern pred:*:gpId rate les emails avec @ dans Upstash
  const allPredKeys = await kvScanAll("pred:*");

  // Cles alternatives pour ce GP (double-sauvegarde de save-prediction.js)
  const ALT = {
    "austria-2026"    : "gp-r10-2026",
    "britain-2026"    : "gp-r11-2026",
    "belgium-2026"    : "gp-r12-2026",
    "hungary-2026"    : "gp-r13-2026",
    "netherlands-2026": "gp-r14-2026",
    "italy-2026"      : "gp-r15-2026",
    "singapore-2026"  : "gp-r16-2026",
    "japan-2026"      : "gp-r17-2026",
    "usa-2026"        : "gp-r18-2026",
    "mexico-2026"     : "gp-r19-2026",
    "brazil-2026"     : "gp-r20-2026",
    "las-vegas-2026"  : "gp-r21-2026",
    "qatar-2026"      : "gp-r22-2026",
    "abu-dhabi-2026"  : "gp-r23-2026",
  };
  const altGpId = ALT[gpId] || null;

  // Filtre JS : garde uniquement les cles de ce GP
  const gpKeys = allPredKeys.filter(
    (k) => k.endsWith(":" + gpId) || (altGpId && k.endsWith(":" + altGpId))
  );

  // Dedoublonne par email (une seule cle par joueur)
  const emailSeen = new Set();
  const uniqueKeys = gpKeys.filter((k) => {
    const parts = k.split(":");
    // cle = pred:email@domain.com:gpId → email = parts[1] (ou parts[1]+':'+parts[2] si sous-domaine)
    const email = parts.slice(1, -1).join(":");
    if (emailSeen.has(email)) return false;
    emailSeen.add(email);
    return true;
  });

  if (debug) {
    return new Response(
      JSON.stringify({
        debug: true,
        gpId,
        results,
        totalPredKeys: allPredKeys.length,
        gpKeys: gpKeys.length,
        uniqueKeys: uniqueKeys.length,
        keys: uniqueKeys,
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  if (!uniqueKeys.length) {
    return new Response(
      JSON.stringify({ success: false, message: "Aucune prediction trouvee pour " + gpId, totalScanned: allPredKeys.length }),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  // ── Calcul et sauvegarde des points ──
  let updated = 0;
  let totalPts = 0;
  const updatedProfiles = new Map();
  const details = [];

  await Promise.allSettled(
    uniqueKeys.map(async (key) => {
      try {
        const parts = key.split(":");
        const email = parts.slice(1, -1).join(":");
        if (!email) return;

        const predRaw = await kvGet(key);
        if (!predRaw) return;
        const pred = JSON.parse(predRaw);
        if (!Array.isArray(pred) || !pred.length) return;

        const pRaw = await kvGet("profile:" + email.toLowerCase());
        if (!pRaw) return;
        const profile = JSON.parse(pRaw);

        // Calcul des points avec detail
        const { total: gpPts, detail: predDetail } = calcPtsDetail(pred, results, profile.plan || "free");

        // Mise a jour du profil
        // Si ce GP avait deja ete calcule avec un mauvais classement, on soustrait l ancien score
        const previousGpPts = profile.gpHistory && profile.gpHistory[gpId] ? (profile.gpHistory[gpId].pts || 0) : 0;
        profile.points = Math.max(0, (profile.points || 0) - previousGpPts + gpPts);
        if (!profile.gpHistory) profile.gpHistory = {};
        profile.gpHistory[gpId] = {
          pts     : gpPts,
          pred    : pred.map((p) => (typeof p === "string" ? p : p?.sn || "")).slice(0, 10),
          results : results.slice(0, 10),
          ts      : Date.now(),
        };

        await kvSet("profile:" + email.toLowerCase(), profile);
        updatedProfiles.set(email.toLowerCase(), profile);
        updated++;
        totalPts += gpPts;
        details.push({ email, handle: profile.handle || "", gpPts, total: profile.points, detail: predDetail });
      } catch {}
    })
  );

  // ── Sync ligues + classement ──
  const leaguesUpdated = updated > 0 ? await syncLeagues(updatedProfiles) : 0;
  const playersRanked  = updated > 0 ? await rebuildStandings(updatedProfiles) : 0;

  // Marquer comme calcule (seulement si au moins 1 joueur)
  if (updated > 0) {
    await kvSet(
      "config:scores_done:" + gpId,
      JSON.stringify({ ts: Date.now(), results, updated })
    );
  }

  return new Response(
    JSON.stringify({
      success       : true,
      gpId,
      results,
      updated,
      avgPts        : updated ? Math.round(totalPts / updated) : 0,
      leaguesUpdated,
      playersRanked,
      top5          : details.sort((a, b) => b.gpPts - a.gpPts).slice(0, 5),
      message       : updated + " joueurs mis a jour - " + leaguesUpdated + " ligues - " + playersRanked + " classes",
    }),
    { headers: { "Content-Type": "application/json" } }
  );
}
