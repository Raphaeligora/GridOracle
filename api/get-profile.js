// api/get-profile.js
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
    const email = searchParams.get('email');
    if (!email) return new Response(JSON.stringify({ error: 'Email requis' }), { status: 400, headers });

    const emailKey = email.toLowerCase().trim();
    const raw = await kvGet(`profile:${emailKey}`);

    if (!raw) return new Response(JSON.stringify({ found: false }), { status: 200, headers });

    // Désérialiser proprement — gérer double sérialisation legacy
    let profile;
    try {
      profile = JSON.parse(raw);
      // Si le résultat est encore une string (double sérialisé), parser à nouveau
      if (typeof profile === 'string') profile = JSON.parse(profile);
    } catch(e) {
      return new Response(JSON.stringify({ found: false }), { status: 200, headers });
    }

    return new Response(JSON.stringify({ found: true, profile }), { status: 200, headers });
  } catch (err) {
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
