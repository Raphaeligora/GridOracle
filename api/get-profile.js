// api/get-profile.js
// Récupère un profil joueur par adresse email
// GET /api/get-profile?email=xxx@xxx.com

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Méthode non autorisée' }), { status: 405, headers });
  }

  try {
    const { searchParams } = new URL(req.url);
    const email = searchParams.get('email');

    if (!email) {
      return new Response(JSON.stringify({ error: 'Email requis' }), { status: 400, headers });
    }

    const emailKey = email.toLowerCase().trim();
    const profileKey = `profile:${emailKey}`;

    const raw = await kvGet(profileKey);

    if (!raw) {
      // Profil non trouvé — nouvel utilisateur
      return new Response(JSON.stringify({ found: false }), { status: 200, headers });
    }

    const profile = JSON.parse(raw);
    return new Response(JSON.stringify({ found: true, profile }), { status: 200, headers });

  } catch (err) {
    console.error('get-profile error:', err);
    return new Response(JSON.stringify({ error: 'Erreur serveur' }), { status: 500, headers });
  }
}

async function kvGet(key) {
  const url = `${process.env.KV_REST_API_URL}/get/${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
  });
  const data = await res.json();
  return data.result ?? null;
}
