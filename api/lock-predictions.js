// api/lock-predictions.js
// Cron : verifie si les qualifs ont commence et verrouille les predictions
// Lance automatiquement chaque samedi a 13h00 UTC via vercel.json
export const config = { runtime: "edge" };

const KV  = () => process.env.KV_REST_API_URL;
const TOK = () => process.env.KV_REST_API_TOKEN;
const OPENF1 = "https://api.openf1.org/v1";

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
  const isCron = req.headers.get("x-vercel-cron") === "1";
  const isManual = new URL(req.url).searchParams.get("secret") === "go2026admin";
  if (!isCron && !isManual) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { "Content-Type": "application/json" },
    });
  }

  try {
    // 1. Recuperer la prochaine session Qualifications sur OpenF1
    const now = new Date().toISOString();
    const res = await fetch(
      `${OPENF1}/sessions?session_type=Qualifying&year=2026`,
      { headers: { Accept: "application/json" } }
    );
    if (!res.ok) throw new Error("OpenF1 sessions failed");
    const sessions = await res.json();

    // Trouver la prochaine qualif (date_start dans le futur ou tres recente)
    const upcoming = sessions
      .filter(s => s.date_start)
      .sort((a, b) => new Date(a.date_start) - new Date(b.date_start))
      .find(s => new Date(s.date_end) > new Date(Date.now() - 3600000)); // terminee depuis moins d 1h

    if (!upcoming) {
      return new Response(JSON.stringify({
        success: false,
        message: "Aucune session qualifs trouvee",
      }), { headers: { "Content-Type": "application/json" } });
    }

    // 2. Determiner le gpId depuis le meeting
    let gpId = "unknown";
    try {
      const mRes = await fetch(
        `${OPENF1}/meetings?meeting_key=${upcoming.meeting_key}`,
        { headers: { Accept: "application/json" } }
      );
      if (mRes.ok) {
        const meetings = await mRes.json();
        const meet = meetings[0] || {};
        const raw = (meet.meeting_official_name || meet.meeting_name || "race").toLowerCase()
          .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        // Aliases GP -> gpId
        const aliases = {
          "austri": "austria-2026", "britain": "britain-2026", "british": "britain-2026",
          "belgian": "belgium-2026", "belgi": "belgium-2026",
          "hungarian": "hungary-2026", "hongrie": "hungary-2026",
          "dutch": "netherlands-2026", "netherlands": "netherlands-2026",
          "italian": "italy-2026", "italia": "italy-2026",
          "singapore": "singapore-2026", "japanese": "japan-2026",
          "united-states": "usa-2026", "mexican": "mexico-2026",
          "brazilian": "brazil-2026", "las-vegas": "las-vegas-2026",
          "qatar": "qatar-2026", "abu-dhabi": "abu-dhabi-2026",
          "australian": "australia-2026", "chinese": "china-2026",
          "canadian": "canada-2026", "spanish": "spain-2026",
          "miami": "miami-2026", "bahrain": "bahrain-2026",
          "saudi": "saudi-arabia-2026", "monaco": "monaco-2026",
        };
        for (const [key, val] of Object.entries(aliases)) {
          if (raw.includes(key)) { gpId = val; break; }
        }
        if (gpId === "unknown") gpId = raw + "-2026";
      }
    } catch {}

    // 3. Verifier si les qualifs ont commence (ou sont sur le point de commencer)
    const qualiStart = new Date(upcoming.date_start);
    const qualiEnd   = new Date(upcoming.date_end);
    const nowDate    = new Date();

    // Verrouiller si les qualifs ont commence
    const shouldLock = nowDate >= qualiStart;
    // Deverrouiller si les qualifs ne sont pas encore commencees
    const shouldUnlock = nowDate < qualiStart;

    if (shouldLock) {
      // Verrouiller les predictions pour ce GP
      await kvSet(`config:quali_locked:${gpId}`, "1");
      await kvSet("config:quali_locked_at", JSON.stringify({
        gpId,
        lockedAt: nowDate.toISOString(),
        qualiStart: upcoming.date_start,
        qualiEnd: upcoming.date_end,
      }));

      return new Response(JSON.stringify({
        success: true,
        action: "locked",
        gpId,
        qualiStart: upcoming.date_start,
        message: `Predictions verrouillees pour ${gpId}`,
      }), { headers: { "Content-Type": "application/json" } });
    }

    if (shouldUnlock) {
      // S assurer que le verrou est leve pour le prochain GP
      const alreadyLocked = await kvGet(`config:quali_locked:${gpId}`);
      if (alreadyLocked) {
        await kvSet(`config:quali_locked:${gpId}`, "0");
      }

      const msUntilQuali = qualiStart - nowDate;
      const hUntil = Math.round(msUntilQuali / 3600000);

      return new Response(JSON.stringify({
        success: true,
        action: "not_yet",
        gpId,
        qualiStart: upcoming.date_start,
        hoursUntilLock: hUntil,
        message: `Qualifs dans ${hUntil}h - predictions encore ouvertes`,
      }), { headers: { "Content-Type": "application/json" } });
    }

  } catch (e) {
    return new Response(JSON.stringify({
      success: false,
      error: e.message,
    }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
