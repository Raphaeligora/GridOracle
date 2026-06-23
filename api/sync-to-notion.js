// api/sync-to-notion.js
export const config = { runtime: 'edge' };

export default async function handler(req) {
  const headers = { 'Content-Type': 'application/json' };

  // Sécurité — appelle avec ?secret=TON_MOT_DE_PASSE
  const { searchParams } = new URL(req.url);
  if (searchParams.get('secret') !== process.env.SYNC_SECRET) {
    return new Response(JSON.stringify({ error: 'Non autorisé' }), { status: 401, headers });
  }

  try {
    // 1. Récupérer toutes les clés profile
    const res = await fetch(`${process.env.KV_REST_API_URL}/keys/profile:*`, {
      headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
    });
    const data = await res.json();
    const keys = data.result || [];

    let added = 0;
    let errors = 0;

    // 2. Pour chaque profil, créer une page Notion
    for (const key of keys) {
      const r = await fetch(`${process.env.KV_REST_API_URL}/get/${encodeURIComponent(key)}`, {
        headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
      });
      const d = await r.json();
      let profile;
      try { profile = JSON.parse(d.result); } catch { continue; }

      if (!profile?.email) continue;

      const ok = await addToNotion(profile);
      if (ok) added++; else errors++;
    }

    return new Response(JSON.stringify({ success: true, added, errors, total: keys.length }), { status: 200, headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
}

async function addToNotion(profile) {
  try {
    const res = await fetch('https://api.notion.com/v1/pages', {
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
          'Inscrit le': { date: { start: new Date(profile.createdAt || Date.now()).toISOString() } },
        }
      })
    });
    return res.ok;
  } catch { return false; }
}

