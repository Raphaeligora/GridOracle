// api/lock-predictions.js — v2 Sprint
// Gere verrou Sprint ET Course principale
// GET ?secret=go2026admin&type=sprint|race|unlock&gpId=xxx
// Cron auto : samedi 12h UTC (avant qualifs course)
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

export default async function handler(req) {
  const url     = new URL(req.url);
  const isCron  = req.headers.get("x-vercel-cron") === "1";
  const isManual = url.searchParams.get("secret") === SECRET;

  if (!isCron && !isManual) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { "Content-Type": "application/json" },
    });
  }

  const type  = url.searchParams.get("type") || "race"; // sprint | race | unlock
  const gpId  = url.searchParams.get("gpId") || "britain-2026";

  // ── Mode manuel depuis l'admin ──
  if (isManual && type === "sprint") {
    await kvSet(`config:sprint_locked:${gpId}`, "1");
    await kvSet(`config:sprint_locked_at:${gpId}`, new Date().toISOString());
    return new Response(JSON.stringify({
      success: true,
      action: "sprint_locked",
      gpId,
      message: "Predictions Sprint verrouillees pour " + gpId,
    }), { headers: { "Content-Type": "application/json" } });
  }

  if (isManual && type === "race") {
    await kvSet(`config:quali_locked:${gpId}`, "1");
    await kvSet(`config:quali_locked_at`, JSON.stringify({
      gpId, lockedAt: new Date().toISOString(),
    }));
    return new Response(JSON.stringify({
      success: true,
      action: "race_locked",
      gpId,
      message: "Predictions Course verrouillees pour " + gpId,
    }), { headers: { "Content-Type": "application/json" } });
  }

  if (isManual && type === "unlock") {
    await kvSet(`config:quali_locked:${gpId}`, "0");
    await kvSet(`config:sprint_locked:${gpId}`, "0");
    return new Response(JSON.stringify({
      success: true,
      action: "unlocked",
      gpId,
      message: "Predictions deverrouillees pour " + gpId,
    }), { headers: { "Content-Type": "application/json" } });
  }

  // ── Mode cron automatique (samedi 12h → verrou Course) ──
  try {
    const OPENF1 = "https://api.openf1.org/v1";
    const now = new Date();
    const res = await fetch(
      `${OPENF1}/sessions?session_type=Qualifying&year=2026`,
      { headers: { Accept: "application/json" } }
    );
    if (!res.ok) throw new Error("OpenF1 failed");
    const sessions = await res.json();

    const upcoming = sessions
      .filter(s => s.date_start)
      .sort((a, b) => new Date(a.date_start) - new Date(b.date_start))
      .find(s => new Date(s.date_end) > new Date(Date.now() - 3600000));

    if (!upcoming) {
      return new Response(JSON.stringify({
        success: false, message: "Aucune session qualifs trouvee",
      }), { headers: { "Content-Type": "application/json" } });
    }

    const aliases = {
      "austri":"austria-2026","britain":"britain-2026","british":"britain-2026",
      "belgian":"belgium-2026","hungarian":"hungary-2026","dutch":"netherlands-2026",
      "italian":"italy-2026","singapore":"singapore-2026","japanese":"japan-2026",
      "united-states":"usa-2026","mexican":"mexico-2026","brazilian":"brazil-2026",
      "las-vegas":"las-vegas-2026","qatar":"qatar-2026","abu-dhabi":"abu-dhabi-2026",
      "australian":"australia-2026","chinese":"china-2026","canadian":"canada-2026",
      "spanish":"spain-2026","miami":"miami-2026","bahrain":"bahrain-2026",
      "saudi":"saudi-arabia-2026","monaco":"monaco-2026",
    };

    let resolvedGpId = "race-2026";
    try {
      const mRes = await fetch(
        `${OPENF1}/meetings?meeting_key=${upcoming.meeting_key}`,
        { headers: { Accept: "application/json" } }
      );
      if (mRes.ok) {
        const meetings = await mRes.json();
        const name = (meetings[0]?.meeting_name || "").toLowerCase()
          .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
          .replace(/[^a-z0-9]+/g,"-");
        for (const [k,v] of Object.entries(aliases)) {
          if (name.includes(k)) { resolvedGpId = v; break; }
        }
      }
    } catch {}

    const qualiStart = new Date(upcoming.date_start);
    if (now >= qualiStart) {
      await kvSet(`config:quali_locked:${resolvedGpId}`, "1");
      await kvSet(`config:quali_locked_at`, JSON.stringify({
        gpId: resolvedGpId,
        lockedAt: now.toISOString(),
        qualiStart: upcoming.date_start,
      }));
      return new Response(JSON.stringify({
        success: true, action: "auto_locked", gpId: resolvedGpId,
        message: "Course verrouillée automatiquement pour " + resolvedGpId,
      }), { headers: { "Content-Type": "application/json" } });
    }

    const hUntil = Math.round((qualiStart - now) / 3600000);
    return new Response(JSON.stringify({
      success: true, action: "not_yet", gpId: resolvedGpId,
      hoursUntilLock: hUntil,
      message: "Qualifs dans " + hUntil + "h - predictions encore ouvertes",
    }), { headers: { "Content-Type": "application/json" } });

  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: e.message }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
}
