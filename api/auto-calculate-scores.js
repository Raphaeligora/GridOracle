// api/auto-calculate-scores.js — OpenF1 + calcul automatique + sync ligues
// FIX v2 : gpId normalisé, NAME_MAP complet, reset du flag si 0 joueurs
export const config = { runtime: 'edge' };

const ADMIN_SECRET = 'go2026admin';
const F1_PTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
const OPENF1 = 'https://api.openf1.org/v1';
const KV  = () => process.env.KV_REST_API_URL;
const TOK = () => process.env.KV_REST_API_TOKEN;

async function kvGet(k) {
  const r = await fetch(`${KV()}/get/${encodeURIComponent(k)}`, {
    headers: { Authorization: `Bearer ${TOK()}` },
  });
  return (await r.json()).result ?? null;
}
async function kvSet(k, v) {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  await fetch(`${KV()}/set/${encodeURIComponent(k)}/${encodeURIComponent(s)}`, {
    headers: { Authorization: `Bearer ${TOK()}` },
  });
}

/* ── NAME_MAP complet 2026 ──
   Clé = last_name renvoyé par OpenF1 (sensible à la casse)
   Valeur = sn stocké dans les prédictions GridOracle */
const NAME_MAP = {
  // Red Bull
  'Verstappen' : 'Verstappen',
  'Hadjar'     : 'Hadjar',
  // McLaren
  'Norris'     : 'Norris',
  'Piastri'    : 'Piastri',
  // Mercedes
  'Russell'    : 'Russell',
  'Antonelli'  : 'Antonelli',
  // Ferrari
  'Leclerc'    : 'Leclerc',
  'Hamilton'   : 'Hamilton',
  // Williams
  'Sainz'      : 'Sainz',
  'Albon'      : 'Albon',
  // Racing Bulls
  'Lawson'     : 'Lawson',
  'Lindblad'   : 'Lindblad',
  // Aston Martin
  'Alonso'     : 'Alonso',
  'Stroll'     : 'Stroll',
  // Haas
  'Ocon'       : 'Ocon',
  'Bearman'    : 'Bearman',
  // Audi
  'Hulkenberg' : 'Hulkenberg',  // OpenF1 sans tréma
  'Hülkenberg' : 'Hulkenberg',  // au cas où
  'Bortoleto'  : 'Bortoleto',
  // Alpine
  'Gasly'      : 'Gasly',
  'Colapinto'  : 'Colapinto',
  // Cadillac
  'Perez'      : 'Pérez',       // OpenF1 sans accent
  'Pérez'      : 'Pérez',
  'Bottas'     : 'Bottas',
  // Anciens (sécurité)
  'Doohan'     : 'Doohan',
  'Tsunoda'    : 'Tsunoda',
};

/* ── FIX BUG 1 : normalisation du gpId ──
   Transforme n'importe quel nom OpenF1 → gpId cohérent avec ton site.
   Exemples :
     "Austrian Grand Prix"       → "austria-2026"
     "Grand Prix d'Autriche"     → "austria-2026"
     "Formula 1 AWS Austrian..." → "austria-2026" */
const GP_ID_ALIASES = {
  'austri'   : 'austria-2026',
  'autriche' : 'austria-2026',
  'monaco'   : 'monaco-2026',
  'monaco'   : 'monaco-2026',
  'british'  : 'great-britain-2026',
  'grande-bretagne' : 'great-britain-2026',
  'italian'  : 'italy-2026',
  'italia'   : 'italy-2026',
  'belgian'  : 'belgium-2026',
  'belgique' : 'belgium-2026',
  'hungarian': 'hungary-2026',
  'hongrie'  : 'hungary-2026',
  'dutch'    : 'netherlands-2026',
  'pays-bas' : 'netherlands-2026',
  'singapore': 'singapore-2026',
  'japanese' : 'japan-2026',
  'japon'    : 'japan-2026',
  'united-states': 'usa-2026',
  'etats-unis'   : 'usa-2026',
  'mexican'  : 'mexico-2026',
  'mexique'  : 'mexico-2026',
  'brazilian': 'brazil-2026',
  'bresil'   : 'brazil-2026',
  'las-vegas': 'las-vegas-2026',
  'qatar'    : 'qatar-2026',
  'abu-dhabi': 'abu-dhabi-2026',
  'australian': 'australia-2026',
  'australie' : 'australia-2026',
  'chinese'   : 'china-2026',
  'chine'     : 'china-2026',
  'canadian'  : 'canada-2026',
  'canada'    : 'canada-2026',
  'spanish'   : 'spain-2026',
  'espagne'   : 'spain-2026',
  'barcelona' : 'spain-2026',
  'miami'     : 'miami-2026',
  'bahrain'   : 'bahrain-2026',
  'bahrein'   : 'bahrain-2026',
  'saudi'     : 'saudi-arabia-2026',
  'arabie'    : 'saudi-arabia-2026',
};

function normalizeGpId(rawName) {
  // Transforme le nom brut OpenF1 en slug bas de casse sans accents
  const slug = rawName
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // retire accents
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  // Cherche un alias connu
  for (const [pattern, canonical] of Object.entries(GP_ID_ALIASES)) {
    if (slug.includes(pattern)) return canonical;
  }
  // Fallback : slug + -2026
  return slug.replace(/-2026$/, '') + '-2026';
}

/* ── Sync ligues ── */
async function syncLeaguesForProfiles(updatedProfiles) {
  for (const [email, profile] of updatedProfiles) {
    try {
      const lidsRaw = await kvGet(`user:${profile.handle}:leagues`);
      if (!lidsRaw) continue;
      const lids = JSON.parse(lidsRaw);
      await Promise.allSettled(lids.map(async lid => {
        const mRaw = await kvGet(`league:${lid}:members`);
        if (!mRaw) return;
        const members = JSON.parse(mRaw);
        const idx = members.findIndex(m => m.email === email || m.handle === profile.handle);
        if (idx < 0) return;
        members[idx].pts = profile.points || 0;
        await kvSet(`league:${lid}:members`, members);
      }));
    } catch {}
  }
}

/* ── OpenF1 : résultats de la dernière course ── */
async function getLatestRaceResults() {
  try {
    const sessRes = await fetch(`${OPENF1}/sessions?session_type=Race&year=2026`, {
      headers: { Accept: 'application/json' },
    });
    if (!sessRes.ok) throw new Error('Sessions API failed');
    const sessions = await sessRes.json();
    const now = new Date().toISOString();
    const finished = sessions
      .filter(s => s.date_end && s.date_end < now)
      .sort((a, b) => new Date(b.date_end) - new Date(a.date_end));
    if (!finished.length) return null;
    const session = finished[0];

    // Positions finales
    const posRes = await fetch(`${OPENF1}/position?session_key=${session.session_key}`, {
      headers: { Accept: 'application/json' },
    });
    if (!posRes.ok) throw new Error('Positions API failed');
    const positions = await posRes.json();
    if (!positions.length) return null;

    // Pilotes
    const drvRes = await fetch(`${OPENF1}/drivers?session_key=${session.session_key}`, {
      headers: { Accept: 'application/json' },
    });
    const drivers = drvRes.ok ? await drvRes.json() : [];
    const driverMap = {};
    drivers.forEach(d => {
      const lastName = d.last_name || '';
      driverMap[d.driver_number] = NAME_MAP[lastName] || lastName || ('D' + d.driver_number);
    });

    // Dernière position connue par pilote
    const lastPos = {};
    positions.forEach(p => {
      if (!lastPos[p.driver_number] || new Date(p.date) > new Date(lastPos[p.driver_number].date))
        lastPos[p.driver_number] = p;
    });
    const finalOrder = Object.values(lastPos)
      .sort((a, b) => a.position - b.position)
      .slice(0, 10)
      .map(p => driverMap[p.driver_number] || 'Unknown');

    // FIX BUG 1 : normalisation du gpId via le meeting name
    let gpId = 'race-2026', gpName = 'Grand Prix 2026';
    try {
      const mRes = await fetch(`${OPENF1}/meetings?meeting_key=${session.meeting_key}`, {
        headers: { Accept: 'application/json' },
      });
      if (mRes.ok) {
        const m = await mRes.json();
        const meet = m[0] || {};
        const rawName = meet.meeting_official_name || meet.meeting_name || 'race';
        gpName = rawName;
        gpId = normalizeGpId(rawName); // ← FIX : utilise l'alias normalisé
      }
    } catch {}

    // FIX : si gpId générique (race-2026, grand-prix-2026...) → identifier via date
    if (gpId.startsWith('race-') || gpId.startsWith('grand-prix-') || gpId === 'race-2026') {
      const raceDate = new Date(session.date_start);
      const month = raceDate.getUTCMonth() + 1; // 1-12
      const day   = raceDate.getUTCDate();
      // Calendrier 2026 approximatif par date
      if (month === 6 && day >= 25 && day <= 30) gpId = 'austria-2026';
      else if (month === 7 && day >= 1  && day <= 6)  gpId = 'britain-2026';
      else if (month === 7 && day >= 23 && day <= 28) gpId = 'hungary-2026';
      else if (month === 7 && day >= 28)              gpId = 'belgium-2026';
      else if (month === 8)                           gpId = 'netherlands-2026';
      else if (month === 9 && day <= 7)               gpId = 'italy-2026';
      else if (month === 9 && day >= 18)              gpId = 'singapore-2026';
      else if (month === 10 && day <= 5)              gpId = 'japan-2026';
      else if (month === 10 && day >= 19)             gpId = 'usa-2026';
      else if (month === 10 && day >= 25)             gpId = 'mexico-2026';
      else if (month === 11 && day <= 9)              gpId = 'brazil-2026';
      else if (month === 11 && day >= 19)             gpId = 'las-vegas-2026';
      else if (month === 11 && day >= 28)             gpId = 'qatar-2026';
      else if (month === 12)                          gpId = 'abu-dhabi-2026';
      else if (month <= 3)                            gpId = 'bahrain-2026';
      else if (month === 4 && day <= 6)               gpId = 'saudi-arabia-2026';
      else if (month === 4 && day >= 17)              gpId = 'australia-2026';
      else if (month === 5 && day <= 4)               gpId = 'china-2026';
      else if (month === 5 && day >= 7 && day <= 12)  gpId = 'miami-2026';
      else if (month === 5 && day >= 20)              gpId = 'monaco-2026';
      else if (month === 6 && day <= 8)               gpId = 'spain-2026';
      else if (month === 6 && day >= 12 && day <= 16) gpId = 'canada-2026';
    }

    return { gpId, gpName, results: finalOrder, sessionKey: session.session_key };
  } catch (e) {
    console.error('OpenF1:', e.message);
    return null;
  }
}

/* ── Calcul des points ── */
function calcPts(prediction, results, plan) {
  const max = (plan === 'premium' || plan === 'creator') ? 10 : 5;
  let pts = 0;
  for (let i = 0; i < Math.min(max, results.length, prediction.length); i++) {
    const p = (typeof prediction[i] === 'string' ? prediction[i] : prediction[i]?.sn || '').trim();
    const r = results[i].trim();
    if (p.toLowerCase() === r.toLowerCase()) pts += F1_PTS[i] || 0;
  }
  return pts;
}

async function processScores(gpId, results) {
  // FIX : scanner pred:* (large) puis filtrer en JS
  // Le pattern pred:*:gpId ne matche pas les emails avec @ dans Upstash
  let cursor = '0', allKeys = [];
  do {
    const s = await fetch(
      `${KV()}/scan/${cursor}/match/${encodeURIComponent('pred:*')}/count/500`,
      { headers: { Authorization: `Bearer ${TOK()}` } }
    );
    const d = await s.json();
    const [nc, keys] = d.result || ['0', []];
    cursor = nc;
    allKeys.push(...(keys || []));
  } while (cursor !== '0');

  // Filtrer uniquement les clés pour ce GP (gpId principal + clé alternative)
  // save-prediction sauvegarde sous pred:email:austria-2026 ET pred:email:gp-r10-2026
  const ALT_ID = {
    'austria-2026':'gp-r10-2026',   'gp-r10-2026':'austria-2026',
    'britain-2026':'gp-r11-2026',   'gp-r11-2026':'britain-2026',
    'belgium-2026':'gp-r12-2026',   'gp-r12-2026':'belgium-2026',
    'hungary-2026':'gp-r13-2026',   'gp-r13-2026':'hungary-2026',
    'netherlands-2026':'gp-r14-2026','gp-r14-2026':'netherlands-2026',
    'italy-2026':'gp-r15-2026',     'gp-r15-2026':'italy-2026',
    'singapore-2026':'gp-r16-2026', 'gp-r16-2026':'singapore-2026',
    'japan-2026':'gp-r17-2026',     'gp-r17-2026':'japan-2026',
    'usa-2026':'gp-r18-2026',       'gp-r18-2026':'usa-2026',
    'mexico-2026':'gp-r19-2026',    'gp-r19-2026':'mexico-2026',
    'brazil-2026':'gp-r20-2026',    'gp-r20-2026':'brazil-2026',
    'las-vegas-2026':'gp-r21-2026', 'gp-r21-2026':'las-vegas-2026',
    'qatar-2026':'gp-r22-2026',     'gp-r22-2026':'qatar-2026',
    'abu-dhabi-2026':'gp-r23-2026', 'gp-r23-2026':'abu-dhabi-2026',
  };
  const altGpId = ALT_ID[gpId] || null;
  const gpKeys = allKeys.filter(k =>
    k.endsWith(`:${gpId}`) || (altGpId && k.endsWith(`:${altGpId}`))
  );

  if (!gpKeys.length) return { updated: 0, avgPts: 0 };
  // Dédoublonner par email (garder la clé principale si les deux existent)
  const emailsSeen = new Set();
  const dedupedKeys = gpKeys.filter(k => {
    const parts = k.split(':');
    const email = parts.slice(1, -1).join(':');
    if (emailsSeen.has(email)) return false;
    emailsSeen.add(email);
    return true;
  });
  const filteredKeys = dedupedKeys;
  if (!filteredKeys.length) return { updated: 0, avgPts: 0 };

  let updated = 0, total = 0;
  const updatedProfiles = new Map();

  await Promise.allSettled(filteredKeys.map(async key => {
    try {
      const email = key.split(':').slice(1, -1).join(':');
      if (!email) return;
      const predRaw = await kvGet(key);
      if (!predRaw) return;
      const pred = JSON.parse(predRaw);
      if (!Array.isArray(pred)) return;
      const pRaw = await kvGet(`profile:${email.toLowerCase()}`);
      if (!pRaw) return;
      const profile = JSON.parse(pRaw);
      const pts = calcPts(pred, results, profile.plan || 'free');
      profile.points = (profile.points || 0) + pts;
      if (!profile.gpHistory) profile.gpHistory = {};
      profile.gpHistory[gpId] = {
        pts,
        pred: pred.map(p => typeof p === 'string' ? p : p?.sn || '').slice(0, 10),
        results: results.slice(0, 10),
        ts: Date.now(),
      };
      await kvSet(`profile:${email.toLowerCase()}`, profile);
      updatedProfiles.set(email.toLowerCase(), profile);
      updated++;
      total += pts;
    } catch {}
  }));

  await syncLeaguesForProfiles(updatedProfiles);
  return { updated, avgPts: updated ? Math.round(total / updated) : 0 };
}

/* ── Handler principal ── */
export default async function handler(req) {
  const url = new URL(req.url);
  const isCron = req.headers.get('x-vercel-cron') === '1';
  if (!isCron && url.searchParams.get('secret') !== ADMIN_SECRET)
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    });

  const force  = url.searchParams.get('force') === '1';
  const manualGpId = url.searchParams.get('gpId'); // ex: ?gpId=austria-2026

  // Résultats connus des courses passées — fallback si OpenF1 échoue ou retourne race-2026
  const KNOWN_RESULTS = {
    'austria-2026': {
      gpName: 'Grand Prix d'Autriche 2026',
      results: ['Russell','Verstappen','Antonelli','Piastri','Hamilton','Leclerc','Norris','Sainz','Hadjar','Alonso'],
    },
  };

  let gpId, gpName, results;

  // Mode manuel : ?gpId=austria-2026 → utilise les résultats connus directement
  if (manualGpId && KNOWN_RESULTS[manualGpId]) {
    gpId    = manualGpId;
    gpName  = KNOWN_RESULTS[manualGpId].gpName;
    results = KNOWN_RESULTS[manualGpId].results;
  } else {
    // Mode auto : OpenF1
    const raceData = await getLatestRaceResults();
    // Si OpenF1 retourne un gpId générique, check les résultats connus
    if (raceData && KNOWN_RESULTS[raceData.gpId]) {
      gpId    = raceData.gpId;
      gpName  = KNOWN_RESULTS[raceData.gpId].gpName;
      results = KNOWN_RESULTS[raceData.gpId].results; // toujours utiliser les résultats vérifiés
    } else if (raceData && raceData.results.length) {
      gpId    = raceData.gpId;
      gpName  = raceData.gpName;
      results = raceData.results;
    } else {
      return new Response(JSON.stringify({ success: false, message: 'Pas de résultats disponibles — utilise ?gpId=austria-2026 pour forcer' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  const alreadyDone = await kvGet(`config:scores_done:${gpId}`);

  // FIX BUG 3 : si déjà calculé mais updated=0, on recalcule quand même
  if (alreadyDone && !force) {
    const prev = JSON.parse(alreadyDone);
    if (prev.updated > 0) {
      // Vraiment déjà fait correctement
      return new Response(JSON.stringify({
        success: true,
        message: `Déjà calculé pour ${gpId} (${prev.updated} joueurs)`,
        results, skipped: true,
      }), { headers: { 'Content-Type': 'application/json' } });
    }
    // updated était 0 → on refait (bug précédent)
    console.log(`scores_done trouvé mais updated=0 pour ${gpId} → recalcul forcé`);
  }

  const { updated, avgPts } = await processScores(gpId, results);

  // Ne marquer comme "done" que si au moins 1 joueur mis à jour
  if (updated > 0) {
    await kvSet(`config:scores_done:${gpId}`, JSON.stringify({ ts: Date.now(), results, updated }));
  }
  await kvSet(`config:race_results:${gpId}`, JSON.stringify({ gpId, gpName, results, ts: Date.now() }));

  // ✅ Reconstruction du classement WDC depuis tous les profils
  // Appelle update-standings en interne pour reconstruire config:wdc_standings
  let standingsMsg = '';
  try {
    const standingsUrl = new URL('/api/update-standings', url.origin);
    const sRes = await fetch(standingsUrl.toString(), {
      headers: { 'x-internal-call': 'go2026' },
    });
    if (sRes.ok) {
      const sData = await sRes.json();
      standingsMsg = sData.message || '';
    }
  } catch (e) {
    standingsMsg = 'Standings update failed: ' + e.message;
  }

  return new Response(JSON.stringify({
    success: true, gpId, gpName, results, updated, avgPts, leaguesSynced: true,
    standingsMsg,
    message: `✅ ${gpName} — ${updated} joueurs mis à jour · ${standingsMsg}`,
  }), { headers: { 'Content-Type': 'application/json' } });
}
