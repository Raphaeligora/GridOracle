// api/save-prediction.js
// Sauvegarde et lecture des prédictions F1
// Double-clé pour compatibilité : austria-2026 ET gp-r10-2026
export const config = { runtime: 'edge' };

const KV  = () => process.env.KV_REST_API_URL;
const TOK = () => process.env.KV_REST_API_TOKEN;

async function kvGet(key) {
  const r = await fetch(`${KV()}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${TOK()}` }
  });
  return (await r.json()).result ?? null;
}

async function kvSet(key, value) {
  const v = typeof value === 'string' ? value : JSON.stringify(value);
  await fetch(`${KV()}/set/${encodeURIComponent(key)}/${encodeURIComponent(v)}`, {
    headers: { Authorization: `Bearer ${TOK()}` }
  });
}

// Génère les clés alternatives pour un gpId donné
// ex: 'austria-2026' ↔ 'gp-r10-2026'
function altKey(email, gpId) {
  const altIds = {
    'austria-2026':       'gp-r10-2026',
    'gp-r10-2026':        'austria-2026',
    'britain-2026':       'gp-r11-2026',
    'gp-r11-2026':        'britain-2026',
    'belgium-2026':       'gp-r12-2026',
    'gp-r12-2026':        'belgium-2026',
    'hungary-2026':       'gp-r13-2026',
    'gp-r13-2026':        'hungary-2026',
    'netherlands-2026':   'gp-r14-2026',
    'gp-r14-2026':        'netherlands-2026',
  };
  const alt = altIds[gpId];
  if (!alt) return null;
  return `pred:${email.toLowerCase()}:${alt}`;
}

export default async function handler(req) {

  // ── GET : charger la prédiction ──────────────────────────────────
  if (req.method === 'GET') {
    const url   = new URL(req.url);
    const email = url.searchParams.get('email');
    const gp    = url.searchParams.get('gp');

    if (!email || !gp) {
      return new Response(JSON.stringify({ found: false, error: 'email et gp requis' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      });
    }

    // Essayer la clé principale d'abord
    const primaryKey = `pred:${email.toLowerCase()}:${gp}`;
    let raw = await kvGet(primaryKey);

    // Si pas trouvée, essayer la clé alternative (compat ancienne version)
    if (!raw) {
      const alt = altKey(email, gp);
      if (alt) raw = await kvGet(alt);
    }

    if (!raw) {
      return new Response(JSON.stringify({ found: false, prediction: null }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    let prediction;
    try { prediction = JSON.parse(raw); }
    catch {
      return new Response(JSON.stringify({ found: false, prediction: null }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ found: true, prediction }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // ── POST : sauvegarder la prédiction ─────────────────────────────
  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); }
    catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      });
    }

    const { email, handle, gpId, gpName, prediction } = body;

    if (!email || !gpId || !prediction) {
      return new Response(JSON.stringify({ error: 'email, gpId et prediction requis' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      });
    }

    // Vérification verrouillage côté serveur
    const lockRaw = await kvGet(`config:quali_locked:${gpId}`);
    if (lockRaw === '1') {
      return new Response(JSON.stringify({ success: false, locked: true, reason: 'Qualifications verrouillées' }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Normaliser la prédiction
    const normalized = (Array.isArray(prediction) ? prediction : [])
      .filter(Boolean)
      .map(d => ({
        sn: typeof d === 'string' ? d : (d.sn || ''),
        n:  typeof d === 'string' ? d : (d.n  || d.sn || ''),
        tc: typeof d === 'string' ? '#e8001d' : (d.tc || '#e8001d'),
      }))
      .filter(d => d.sn);

    if (!normalized.length) {
      return new Response(JSON.stringify({ error: 'Prédiction vide' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      });
    }

    // Sauvegarder sous la clé principale
    const primaryKey = `pred:${email.toLowerCase()}:${gpId}`;
    await kvSet(primaryKey, normalized);

    // Sauvegarder aussi sous la clé alternative pour compatibilité
    const alt = altKey(email, gpId);
    if (alt) await kvSet(alt, normalized);

    // Mettre à jour le profil
    try {
      const profileRaw = await kvGet(`profile:${email.toLowerCase()}`);
      if (profileRaw) {
        const profile = JSON.parse(profileRaw);
        profile.lastPredGp  = gpId;
        profile.lastPredTs  = Date.now();
        profile.predsCount  = (profile.predsCount || 0) + 1;
        await kvSet(`profile:${email.toLowerCase()}`, profile);
      }
    } catch {}

    return new Response(JSON.stringify({
      success: true,
      gpId,
      saved: normalized.length,
    }), { headers: { 'Content-Type': 'application/json' } });
  }

  return new Response('Method not allowed', { status: 405 });
}
