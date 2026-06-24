export const config = { runtime: 'edge' };

const KV  = () => process.env.KV_REST_API_URL;
const TOK = () => process.env.KV_REST_API_TOKEN;

async function kvGet(key) {
  const r = await fetch(`${KV()}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${TOK()}` }
  });
  const d = await r.json();
  return d.result ?? null;
}

export default async function handler(req) {
  const url    = new URL(req.url);
  const handle = url.searchParams.get('handle');

  if (!handle) {
    return new Response(JSON.stringify({ error: 'handle requis' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const idsRaw = await kvGet(`user:${handle}:leagues`);
  const ids    = idsRaw ? JSON.parse(idsRaw) : [];

  if (!ids.length) {
    return new Response(JSON.stringify({ leagues: [] }), { headers: { 'Content-Type': 'application/json' } });
  }

  // Charger chaque ligue en parallèle
  const leagues = (await Promise.all(ids.map(async id => {
    try {
      const raw = await kvGet(`league:${id}`);
      if (!raw) return null;
      const league = JSON.parse(raw);
      // Ajouter le nombre réel de membres
      const mRaw = await kvGet(`league:${id}:members`);
      league.memberCount = mRaw ? JSON.parse(mRaw).length : 0;
      return league;
    } catch { return null; }
  }))).filter(Boolean);

  return new Response(JSON.stringify({ leagues }), {
    headers: { 'Content-Type': 'application/json' }
  });
}
