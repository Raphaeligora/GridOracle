// api/save-profile.js
// Sauvegarde ou met à jour un profil joueur dans Upstash Redis
// Clé : "profile:{email}"

export const config = { runtime: 'edge' };

export default async function handler(req) {
  // CORS
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
    const body = await req.json();
    const { email, fn, ln, handle, tc, teamId, driverSn, plan, billing } = body;

    if (!email || !fn || !ln || !handle) {
      return new Response(JSON.stringify({ error: 'Champs obligatoires manquants' }), { status: 400, headers });
    }

    const emailKey = email.toLowerCase().trim();
    const profileKey = `profile:${emailKey}`;

    // Récupère profil existant pour ne pas écraser le plan si déjà payant
    const existing = await kvGet(profileKey);
    const existingData = existing ? JSON.parse(existing) : null;

    const profile = {
      email: emailKey,
      fn,
      ln,
      handle,
      tc: tc || '#e8001d',
      teamId: teamId || null,
      driverSn: driverSn || null,
      // Conserver le plan existant si plus élevé
      plan: resolvePlan(existingData?.plan, plan),
      billing: billing || existingData?.billing || 'monthly',
      createdAt: existingData?.createdAt || Date.now(),
      updatedAt: Date.now(),
    };

    // Sauvegarder : clé par email + clé par handle (pour unicité)
    await kvSet(profileKey, JSON.stringify(profile));
    await kvSet(`handle:${handle.toLowerCase()}`, emailKey);

    return new Response(JSON.stringify({ success: true, profile }), { status: 200, headers });

  } catch (err) {
    console.error('save-profile error:', err);
    return new Response(JSON.stringify({ error: 'Erreur serveur' }), { status: 500, headers });
  }
}

// Priorité des plans : creator > premium > free
function resolvePlan(existing, incoming) {
  const rank = { free: 0, premium: 1, creator: 2 };
  const eRank = rank[existing] ?? 0;
  const iRank = rank[incoming] ?? 0;
  return iRank >= eRank ? (incoming || 'free') : existing;
}

// Upstash Redis via REST API
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
