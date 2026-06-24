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
  const id     = url.searchParams.get('id');
  const code   = url.searchParams.get('code');

  let leagueId = id;

  // Résoudre via code si pas d'ID direct
  if (!leagueId && code) {
    leagueId = await kvGet(`invite:${code.toUpperCase().trim()}`);
    if (!leagueId) {
      return new Response(JSON.stringify({ error: 'Code introuvable' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }
  }

  if (!leagueId) {
    return new Response(JSON.stringify({ error: 'id ou code requis' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const leagueRaw = await kvGet(`league:${leagueId}`);
  if (!leagueRaw) {
    return new Response(JSON.stringify({ error: 'Ligue introuvable' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  const league  = JSON.parse(leagueRaw);
  const membersRaw = await kvGet(`league:${leagueId}:members`);
  let members   = membersRaw ? JSON.parse(membersRaw) : [];

  // Refresh points depuis les profils (best-effort)
  const refreshed = await Promise.all(members.map(async m => {
    try {
      if (m.email) {
        const pRaw = await kvGet(`profile:${m.email.toLowerCase()}`);
        if (pRaw) {
          const p = JSON.parse(pRaw);
          return { ...m, pts: p.points || m.pts || 0 };
        }
      }
    } catch {}
    return m;
  }));

  const sorted = refreshed
    .sort((a, b) => (b.pts || 0) - (a.pts || 0))
    .map((m, i) => ({ ...m, rank: i + 1 }));

  return new Response(JSON.stringify({ league, members: sorted }), {
    headers: { 'Content-Type': 'application/json' }
  });
}
