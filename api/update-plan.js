// api/update-plan.js
// Met à jour le plan d'un profil après paiement Stripe
// POST { email, plan, billing }

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Méthode non autorisée' }), { status: 405, headers });
  }

  try {
    const { email, plan, billing } = await req.json();

    if (!email || !plan) {
      return new Response(JSON.stringify({ error: 'Email et plan requis' }), { status: 400, headers });
    }

    const emailKey = email.toLowerCase().trim();
    const profileKey = `profile:${emailKey}`;

    const raw = await kvGet(profileKey);
    if (!raw) {
      return new Response(JSON.stringify({ error: 'Profil introuvable' }), { status: 404, headers });
    }

    const profile = JSON.parse(raw);
    profile.plan = plan;
    profile.billing = billing || 'monthly';
    profile.planActivatedAt = Date.now();
    profile.updatedAt = Date.now();

    await kvSet(profileKey, JSON.stringify(profile));

    return new Response(JSON.stringify({ success: true, profile }), { status: 200, headers });

  } catch (err) {
    console.error('update-plan error:', err);
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

async function kvSet(key, value) {
  const url = `${process.env.KV_REST_API_URL}/set/${encodeURIComponent(key)}`;
  await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([value]),
  });
}
