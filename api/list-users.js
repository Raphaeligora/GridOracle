// api/list-users.js
// Vercel Edge Function — Liste tous les utilisateurs GridOracle depuis Redis
// Retourne les profils publics (sans email) triés par points décroissants

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'GET') return new Response(JSON.stringify({ error: 'Méthode non autorisée' }), { status: 405, headers });

  try {
    const KV_URL   = process.env.KV_REST_API_URL;
    const KV_TOKEN = process.env.KV_REST_API_TOKEN;

    // 1. SCAN pour récupérer toutes les clés profile:*
    let cursor = 0;
    let allKeys = [];

    do {
      const scanRes = await fetch(
        `${KV_URL}/scan/${cursor}?match=${encodeURIComponent('profile:*')}&count=100`,
        { headers: { Authorization: `Bearer ${KV_TOKEN}` } }
      );
      const scanData = await scanRes.json();
      // Upstash retourne [nextCursor, [keys]]
      const result = scanData.result;
      cursor = parseInt(result[0]);
      allKeys = allKeys.concat(result[1]);
    } while (cursor !== 0);

    if (allKeys.length === 0) {
      return new Response(JSON.stringify({ users: [], total: 0 }), { status: 200, headers });
    }

    // 2. MGET pour récupérer tous les profils en une seule requête
    const mgetBody = allKeys.map(k => encodeURIComponent(k)).join('/');
    const mgetRes = await fetch(
      `${KV_URL}/mget/${mgetBody}`,
      { headers: { Authorization: `Bearer ${KV_TOKEN}` } }
    );
    const mgetData = await mgetRes.json();
    const rawValues = mgetData.result || [];

    // 3. Parser et nettoyer — supprimer l'email, garder infos publiques
    const users = [];
    rawValues.forEach((raw, i) => {
      if (!raw) return;
      try {
        const p = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (!p || !p.handle) return;
        users.push({
          handle:    p.handle,
          fn:        p.fn || '',
          ln:        p.ln || '',
          tc:        p.tc || '#e8001d',
          teamId:    p.teamId || null,
          driverSn:  p.driverSn || null,
          plan:      p.plan || 'free',
          points:    p.points || 0,
          rank:      p.rank || null,
          createdAt: p.createdAt || 0,
          gpsPlayed: p.gpsPlayed || 0,
          precision: p.precision || 0,
          // NE PAS inclure email
        });
      } catch(e) {
        // Profil malformé — on l'ignore
      }
    });

    // 4. Trier par points décroissants, puis par date d'inscription
    users.sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      return a.createdAt - b.createdAt;
    });

    // 5. Assigner les rangs
    users.forEach((u, i) => { u.rank = i + 1; });

    return new Response(JSON.stringify({ users, total: users.length }), { status: 200, headers });

  } catch (err) {
    console.error('list-users error:', err);
    return new Response(JSON.stringify({ error: 'Erreur serveur', users: [] }), { status: 500, headers });
  }
}
