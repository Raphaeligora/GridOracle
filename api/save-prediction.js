// api/save-prediction.js
// Vercel Edge Function — Sauvegarde la prédiction d'un joueur dans Redis
// Bloquée automatiquement à partir du samedi qualifs (configurable par GP)

export const config = { runtime: 'edge' };

// Deadline qualifs GP Autriche — samedi 27 juin 2026 à 15h45 Paris (13h45 UTC)
// On ferme 15 min avant le début officiel des qualifs (16h00)
const QUALI_DEADLINE = new Date('2026-06-27T13:45:00Z').getTime();

export default async function handler(req) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });

  const KV_URL   = process.env.KV_REST_API_URL;
  const KV_TOKEN = process.env.KV_REST_API_TOKEN;

  // ── GET : récupérer la prédiction d'un joueur
  if (req.method === 'GET') {
    const { searchParams } = new URL(req.url);
    const email = searchParams.get('email')?.toLowerCase().trim();
    const gpId  = searchParams.get('gp') || 'austria-2026';
    if (!email) return new Response(JSON.stringify({ error: 'Email requis' }), { status: 400, headers });

    try {
      const key = `pred:${gpId}:${email}`;
      const res = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
        headers: { Authorization: `Bearer ${KV_TOKEN}` }
      });
      const data = await res.json();
      if (!data.result) return new Response(JSON.stringify({ found: false }), { status: 200, headers });
      const pred = JSON.parse(data.result);
      return new Response(JSON.stringify({ found: true, prediction: pred, locked: Date.now() >= QUALI_DEADLINE }), { status: 200, headers });
    } catch(e) {
      return new Response(JSON.stringify({ error: 'Erreur serveur' }), { status: 500, headers });
    }
  }

  // ── POST : sauvegarder / mettre à jour la prédiction
  if (req.method === 'POST') {
    try {
      const body = await req.json();
      const { email, handle, gpId = 'austria-2026', prediction, gpName = 'GP Autriche 2026' } = body;

      if (!email || !prediction || !Array.isArray(prediction)) {
        return new Response(JSON.stringify({ error: 'Données manquantes' }), { status: 400, headers });
      }

      // Vérifier si les qualifs ont commencé
      const now = Date.now();
      if (now >= QUALI_DEADLINE) {
        return new Response(JSON.stringify({
          error: 'Prédictions verrouillées — les qualifications ont commencé',
          locked: true
        }), { status: 403, headers });
      }

      const emailKey = email.toLowerCase().trim();
      const predKey  = `pred:${gpId}:${emailKey}`;

      // Récupérer prédiction existante pour conserver createdAt
      let existingCreatedAt = now;
      try {
        const existRes = await fetch(`${KV_URL}/get/${encodeURIComponent(predKey)}`, {
          headers: { Authorization: `Bearer ${KV_TOKEN}` }
        });
        const existData = await existRes.json();
        if (existData.result) {
          const existing = JSON.parse(existData.result);
          existingCreatedAt = existing.createdAt || now;
        }
      } catch(e) {}

      const predData = {
        email:     emailKey,
        handle:    handle || '',
        gpId,
        gpName,
        prediction, // array de { sn, n, tc, t } — top 5 ou top 10
        createdAt:  existingCreatedAt,
        updatedAt:  now,
        locked:     false,
      };

      // Sauvegarder dans Redis
      await fetch(`${KV_URL}/set/${encodeURIComponent(predKey)}/${encodeURIComponent(JSON.stringify(predData))}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${KV_TOKEN}` }
      });

      // Indexer dans la liste des prédictions du GP pour le leaderboard
      // On utilise un SET Redis pour lister tous les participants d'un GP
      await fetch(`${KV_URL}/sadd/${encodeURIComponent(`predlist:${gpId}`)}/${encodeURIComponent(emailKey)}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${KV_TOKEN}` }
      });

      return new Response(JSON.stringify({
        success: true,
        saved: true,
        updatedAt: now,
        locked: false,
        message: 'Prédiction sauvegardée ✓'
      }), { status: 200, headers });

    } catch(e) {
      console.error('save-prediction error:', e);
      return new Response(JSON.stringify({ error: 'Erreur serveur' }), { status: 500, headers });
    }
  }

  return new Response(JSON.stringify({ error: 'Méthode non autorisée' }), { status: 405, headers });
}
