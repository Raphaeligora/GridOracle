// api/update-plan.js
export const config = { runtime: 'edge' };

export default async function handler(req) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Méthode non autorisée' }), { status: 405, headers });

  try {
    const { email, plan, billing } = await req.json();
    if (!email || !plan) return new Response(JSON.stringify({ error: 'Email et plan requis' }), { status: 400, headers });

    // SÉCURITÉ : le client ne peut PAS s'attribuer un plan payant via cette route.
    // Seul le webhook Stripe (paiement vérifié) accorde premium/creator.
    if (plan !== 'free') {
      return new Response(JSON.stringify({ error: 'Les plans payants sont activés uniquement après un paiement Stripe vérifié.' }), { status: 403, headers });
    }

    const emailKey = email.toLowerCase().trim();
    const profileKey = `profile:${emailKey}`;

    const raw = await kvGet(profileKey);
    if (!raw) return new Response(JSON.stringify({ error: 'Profil introuvable' }), { status: 404, headers });

    let profile;
    try {
      profile = JSON.parse(raw);
      if (typeof profile === 'string') profile = JSON.parse(profile);
    } catch(e) {
      return new Response(JSON.stringify({ error: 'Profil corrompu' }), { status: 500, headers });
    }

    profile.plan = plan;
    profile.billing = billing || 'monthly';
    profile.planActivatedAt = Date.now();
    profile.updatedAt = Date.now();

    await kvSet(profileKey, JSON.stringify(profile));

    return new Response(JSON.stringify({ success: true, profile }), { status: 200, headers });
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

async function kvSet(key, value) {
  await fetch(`${process.env.KV_REST_API_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
  });
}
