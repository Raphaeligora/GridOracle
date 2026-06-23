// api/sync-to-notion.js
export const config = { runtime: 'edge' };

export default async function handler(req) {
  const headers = { 'Content-Type': 'application/json' };

  const { searchParams } = new URL(req.url);
  if (searchParams.get('secret') !== 'Gridoracle2026igr') {
    return new Response(JSON.stringify({ error: 'Non autorisé' }), { status: 401, headers });
  }

  try {
    const res = await fetch(`${process.env.KV_REST_API_URL}/keys/profile:*`, {
      headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
    });
    const data = await res.json();
    const keys = data.result || [];

    let added = 0;
    let errors = 0;
    const errorMessages = [];

    for (const key of keys) {
      const r = await fetch(`${process.env.KV_REST_API_URL}/get/${encodeURIComponent(key)}`, {
        headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
      });
      const d = await r.json();
      let profile;
      try { profile = JSON.parse(d.result); } catch { continue; }
      if (!profile?.email) continue;

      try {
        const ok = await addToNotion(profile);
        if (ok) added++;
      } catch(e) {
        errors++;
        errorMessages.push(e.message);
      }
    }

    return new Response(JSON.stringify({ success: true, added, errors, total: keys.length, errorMessages }), { status: 200, headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
}

async function addToNotion(profile) {
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
        'Nom': { title: [{ text: { content: `${profile.fn || ''} ${profile.ln || ''}`.trim() } }] },
        'Email': { email: profile.email },
        'Handle': { rich_text: [{ text: { content: profile.handle || '' } }] },
        'Plan': { select: { name: profile.plan || 'free' } },
        'Inscrit le': { date: { start: new Date(profile.createdAt).toISOString() } },
      }
    })
  });

  const json = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(json));
  return true;
}

