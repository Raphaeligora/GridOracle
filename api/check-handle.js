// api/check-handle.js
// Vérifie si un nom d'utilisateur est déjà pris
// GET /api/check-handle?handle=raphael_igr

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
    const { searchParams } = new URL(req.url);
    const handle = searchParams.get('handle');

    if (!handle) return new Response(JSON.stringify({ error: 'Handle requis' }), { status: 400, headers });

    const handleKey = `handle:${handle.toLowerCase().trim()}`;
    const existing = await kvGet(handleKey);

    return new Response(JSON.stringify({ taken: !!existing }), { status: 200, headers });

  } catch (err) {
    console.error('check-handle error:', err);
    return new Response(JSON.stringify({ error: 'Erreur serveur' }), { status: 500, headers });
  }
}

async function kvGet(key) {
  const res = await fetch(`${process.env.KV_REST_API_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
  });
  const data = await res.json();
  return data.result ?? null;
}
