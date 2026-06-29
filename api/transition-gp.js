// api/transition-gp.js
// Cron : tous les lundis a midi UTC
// Bascule automatiquement sur le prochain GP
export const config = { runtime: "edge" };

const SECRET = "go2026admin";
const KV  = () => process.env.KV_REST_API_URL;
const TOK = () => process.env.KV_REST_API_TOKEN;

async function kvSet(k, v) {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  await fetch(`${KV()}/set/${encodeURIComponent(k)}/${encodeURIComponent(s)}`, {
    headers: { Authorization: `Bearer ${TOK()}` },
  });
}
async function kvGet(k) {
  const r = await fetch(`${KV()}/get/${encodeURIComponent(k)}`, {
    headers: { Authorization: `Bearer ${TOK()}` },
  });
  return (await r.json()).result ?? null;
}

// Calendrier F1 2026 complet
const CALENDAR_2026 = [
  { id:"bahrain-2026",       name:"Grand Prix de Bahreïn",          flag:"🇧🇭", r:1,  loc:"Sakhir · Bahreïn",                isSprint:false, qualiUTC:"2026-03-21T13:00:00Z" },
  { id:"saudi-arabia-2026",  name:"Grand Prix d'Arabie Saoudite",   flag:"🇸🇦", r:2,  loc:"Djeddah · Arabie Saoudite",        isSprint:false, qualiUTC:"2026-03-28T13:00:00Z" },
  { id:"australia-2026",     name:"Grand Prix d'Australie",         flag:"🇦🇺", r:3,  loc:"Melbourne · Australie",            isSprint:false, qualiUTC:"2026-04-04T06:00:00Z" },
  { id:"china-2026",         name:"Grand Prix de Chine",            flag:"🇨🇳", r:4,  loc:"Shanghai · Chine",                 isSprint:true,  qualiUTC:"2026-04-18T08:00:00Z", sprintId:"sprint-china-2026", sprintDeadlineUTC:"2026-04-17T08:00:00Z" },
  { id:"miami-2026",         name:"Grand Prix de Miami",            flag:"🇺🇸", r:5,  loc:"Miami · États-Unis",               isSprint:true,  qualiUTC:"2026-05-02T20:00:00Z", sprintId:"sprint-miami-2026", sprintDeadlineUTC:"2026-05-01T20:00:00Z" },
  { id:"monaco-2026",        name:"Grand Prix de Monaco",           flag:"🇲🇨", r:6,  loc:"Monaco",                          isSprint:false, qualiUTC:"2026-05-23T13:00:00Z" },
  { id:"spain-2026",         name:"Grand Prix d'Espagne",           flag:"🇪🇸", r:7,  loc:"Barcelone · Espagne",              isSprint:false, qualiUTC:"2026-05-30T13:00:00Z" },
  { id:"canada-2026",        name:"Grand Prix du Canada",           flag:"🇨🇦", r:8,  loc:"Montréal · Canada",               isSprint:false, qualiUTC:"2026-06-13T20:00:00Z" },
  { id:"austria-2026",       name:"Grand Prix d'Autriche",          flag:"🇦🇹", r:9,  loc:"Red Bull Ring · Spielberg",        isSprint:false, qualiUTC:"2026-06-27T13:00:00Z" },
  { id:"britain-2026",       name:"Grand Prix de Grande-Bretagne",  flag:"🇬🇧", r:10, loc:"Silverstone · Northamptonshire",   isSprint:true,  qualiUTC:"2026-07-05T13:00:00Z", sprintId:"sprint-britain-2026", sprintDeadlineUTC:"2026-07-04T10:30:00Z" },
  { id:"belgium-2026",       name:"Grand Prix de Belgique",         flag:"🇧🇪", r:11, loc:"Spa-Francorchamps · Belgique",     isSprint:false, qualiUTC:"2026-07-25T13:00:00Z" },
  { id:"hungary-2026",       name:"Grand Prix de Hongrie",          flag:"🇭🇺", r:12, loc:"Budapest · Hongrie",               isSprint:false, qualiUTC:"2026-08-01T13:00:00Z" },
  { id:"netherlands-2026",   name:"Grand Prix des Pays-Bas",        flag:"🇳🇱", r:13, loc:"Zandvoort · Pays-Bas",             isSprint:false, qualiUTC:"2026-08-29T13:00:00Z" },
  { id:"italy-2026",         name:"Grand Prix d'Italie",            flag:"🇮🇹", r:14, loc:"Monza · Italie",                   isSprint:false, qualiUTC:"2026-09-05T13:00:00Z" },
  { id:"singapore-2026",     name:"Grand Prix de Singapour",        flag:"🇸🇬", r:15, loc:"Marina Bay · Singapour",           isSprint:false, qualiUTC:"2026-09-19T09:00:00Z" },
  { id:"japan-2026",         name:"Grand Prix du Japon",            flag:"🇯🇵", r:16, loc:"Suzuka · Japon",                   isSprint:false, qualiUTC:"2026-10-03T06:00:00Z" },
  { id:"usa-2026",           name:"Grand Prix des États-Unis",      flag:"🇺🇸", r:17, loc:"Austin · États-Unis",              isSprint:true,  qualiUTC:"2026-10-17T20:00:00Z", sprintId:"sprint-usa-2026", sprintDeadlineUTC:"2026-10-16T20:00:00Z" },
  { id:"mexico-2026",        name:"Grand Prix du Mexique",          flag:"🇲🇽", r:18, loc:"Mexico · Mexique",                 isSprint:false, qualiUTC:"2026-10-24T20:00:00Z" },
  { id:"brazil-2026",        name:"Grand Prix du Brésil",           flag:"🇧🇷", r:19, loc:"São Paulo · Brésil",               isSprint:true,  qualiUTC:"2026-11-07T18:00:00Z", sprintId:"sprint-brazil-2026", sprintDeadlineUTC:"2026-11-06T16:00:00Z" },
  { id:"las-vegas-2026",     name:"Grand Prix de Las Vegas",        flag:"🇺🇸", r:20, loc:"Las Vegas · États-Unis",           isSprint:false, qualiUTC:"2026-11-21T06:00:00Z" },
  { id:"qatar-2026",         name:"Grand Prix du Qatar",            flag:"🇶🇦", r:21, loc:"Lusail · Qatar",                   isSprint:true,  qualiUTC:"2026-11-28T13:00:00Z", sprintId:"sprint-qatar-2026", sprintDeadlineUTC:"2026-11-27T11:00:00Z" },
  { id:"abu-dhabi-2026",     name:"Grand Prix d'Abu Dhabi",         flag:"🇦🇪", r:22, loc:"Yas Marina · Abu Dhabi",           isSprint:false, qualiUTC:"2026-12-05T13:00:00Z" },
];

function findCurrentGp() {
  const now = new Date();
  // Prochain GP = premier dont les qualifs sont STRICTEMENT dans le futur
  const upcoming = CALENDAR_2026
    .filter(gp => new Date(gp.qualiUTC) > now)
    .sort((a, b) => new Date(a.qualiUTC) - new Date(b.qualiUTC));
  return upcoming[0] || null;
}

export default async function handler(req) {
  const url    = new URL(req.url);
  const isCron = req.headers.get("x-vercel-cron") === "1";
  const isManual = url.searchParams.get("secret") === SECRET;

  if (!isCron && !isManual) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { "Content-Type": "application/json" },
    });
  }

  const gp = findCurrentGp();
  if (!gp) {
    return new Response(JSON.stringify({ success: false, message: "Aucun GP trouve dans le calendrier" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // Sauvegarder le GP actuel dans KV pour que le site puisse le lire
  await kvSet("config:current_gp", JSON.stringify(gp));
  await kvSet("config:gp_transition_at", new Date().toISOString());

  // Déverrouiller les prédictions pour le nouveau GP
  await kvSet(`config:quali_locked:${gp.id}`, "0");
  if (gp.sprintId) {
    await kvSet(`config:sprint_locked:${gp.sprintId}`, "0");
  }

  return new Response(JSON.stringify({
    success: true,
    gp,
    message: `Transition effectuee : ${gp.flag} ${gp.name} (${gp.id}) - Qualifs le ${new Date(gp.qualiUTC).toLocaleDateString("fr-FR")}`,
  }), { headers: { "Content-Type": "application/json" } });
}
