// api/save-profile.js
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
    const body = await req.json();
    const { email, fn, ln, handle, tc, teamId, driverSn, plan, billing } = body;
    if (!email || !fn || !ln || !handle) return new Response(JSON.stringify({ error: 'Champs manquants' }), { status: 400, headers });

    const emailKey = email.toLowerCase().trim();
    const profileKey = `profile:${emailKey}`;

    // Récupérer profil existant
    const existingRaw = await kvGet(profileKey);
    let existingData = null;
    if (existingRaw) {
      try { existingData = JSON.parse(existingRaw); } catch(e) {}
    }

    const profile = {
      email: emailKey,
      fn, ln, handle,
      tc: tc || '#e8001d',
      teamId: teamId || null,
      driverSn: driverSn || null,
      plan: resolvePlan(existingData?.plan, plan),
      billing: billing || existingData?.billing || 'monthly',
      createdAt: existingData?.createdAt || Date.now(),
      updatedAt: Date.now(),
    };
  // Stocker proprement — valeur directe sans double sérialisation
    await kvSet(profileKey, JSON.stringify(profile));
    await kvSet(`handle:${handle.toLowerCase()}`, emailKey);
    if (!existingData) {
  await addToNotion(profile);
}
    return new Response(JSON.stringify({ success: true, profile }), { status: 200, headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Erreur serveur' }), { status: 500, headers });
  }
}

function resolvePlan(existing, incoming) {
  const rank = { free: 0, premium: 1, creator: 2 };
  return (rank[incoming] ?? 0) >= (rank[existing] ?? 0) ? (incoming || 'free') : existing;
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
async function addToNotion(profile) {
  try {
    await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.NOTION_TOKEN}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        parent: { database_id: process.env.NOTION_DB_ID },
        properties: {
          'Nom': {
            title: [{ text: { content: `${profile.fn || ''} ${profile.ln || ''}`.trim() } }]
          },
          'Email': { email: profile.email },
          'Handle': { rich_text: [{ text: { content: profile.handle || '' } }] },
          'Plan': { select: { name: profile.plan || 'free' } },
          'Inscrit le': { date: { start: new Date(profile.createdAt).toISOString() } },
        }
      })
    });
  } catch (e) {
    console.error('Notion sync failed:', e.message);
  }
}
