// api/save-prediction.js
// Sauvegarde la prédiction d'un joueur pour un GP donné
// POST { email, handle, gpId, gpName, prediction }
// GET  ?email=...&gp=... (charger la prédiction sauvegardée)
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

export default async function handler(req) {
  // ── GET : charger la prédiction d'un joueur ──────────────────────
  if (req.method === 'GET') {
    const url   = new URL(req.url);
    const email = url.searchParams.get('email');
    const gp    = url.searchParams.get('gp');
    if (!email || !gp) {
      return new Response(JSON.stringify({ error: 'email et gp requis' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      });
    }
    const raw = await kvGet(`pred:${email.toLowerCase()}:${gp}`);
    if (!raw) {
      return new Response(JSON.stringify({ prediction: null }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return new Response(JSON.stringify({ prediction: JSON.parse(raw) }), {
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

    // Vérifier que les qualifs ne sont pas verrouillées
    // (Le frontend gère déjà ça, mais on double-vérifie côté serveur)
    const lockRaw = await kvGet(`config:quali_locked:${gpId}`);
    if (lockRaw === '1') {
      return new Response(JSON.stringify({ success: false, locked: true, reason: 'Qualifications verrouillées' }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Normaliser la prédiction (garder seulement sn, n, tc)
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

    // Sauvegarder dans Redis : pred:{email}:{gpId}
    await kvSet(`pred:${email.toLowerCase()}:${gpId}`, normalized);

    // Mettre à jour le profil avec le timestamp de la dernière prédiction
    const profileRaw = await kvGet(`profile:${email.toLowerCase()}`);
    if (profileRaw) {
      const profile = JSON.parse(profileRaw);
      profile.lastPredGp  = gpId;
      profile.lastPredTs  = Date.now();
      profile.predsCount  = (profile.predsCount || 0) + 1;
      await kvSet(`profile:${email.toLowerCase()}`, profile);
    }

    return new Response(JSON.stringify({
      success: true,
      gpId,
      saved: normalized.length,
      message: `✅ Prédiction sauvegardée pour ${gpId}`
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  return new Response('Method not allowed', { status: 405 });
}
