// api/list-users.js
// Retourne le classement mondial de tous les joueurs
// Le compte espion (raphaeligora@gmail.com) est exclu automatiquement
export const config = { runtime: 'edge' };

const KV  = () => process.env.KV_REST_API_URL;
const TOK = () => process.env.KV_REST_API_TOKEN;
const GHOST_EMAIL = 'raphaeligora@gmail.com';

async function kvGet(key) {
  const r = await fetch(`${KV()}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${TOK()}` }
  });
  return (await r.json()).result ?? null;
}

export default async function handler(req) {
  try {
    let cursor = '0';
    const users = [];

    // Scanner tous les profils Redis
    do {
      const res = await fetch(
        `${KV()}/scan/${cursor}/match/${encodeURIComponent('profile:*')}/count/200`,
        { headers: { Authorization: `Bearer ${TOK()}` } }
      );
      const data = await res.json();
      const [nextCursor, keys] = data.result || ['0', []];
      cursor = nextCursor;

      await Promise.allSettled((keys || []).map(async (key) => {
        try {
          const raw = await kvGet(key);
          if (!raw) return;
          const p = JSON.parse(raw);
          if (!p.handle || !p.email) return;

          // Exclure le compte espion du classement public
          if (p.email.toLowerCase() === GHOST_EMAIL) return;

          users.push({
            handle:    p.handle,
            email:     p.email,
            fn:        p.fn || '',
            ln:        p.ln || '',
            points:    p.points || 0,
            plan:      p.plan || 'free',
            tc:        p.tc || '#e8001d',
            teamId:    p.teamId || null,
            driverSn:  p.driverSn || null,
            createdAt: p.createdAt || 0
          });
        } catch {}
      }));
    } while (cursor !== '0');

    // Trier par points décroissants et ajouter le rang
    const sorted = users
      .sort((a, b) => (b.points || 0) - (a.points || 0))
      .map((u, i) => ({ ...u, rank: i + 1 }));

    return new Response(
      JSON.stringify({ users: sorted, total: sorted.length }),
      { headers: { 'Content-Type': 'application/json' } }
    );

  } catch (e) {
    return new Response(
      JSON.stringify({ error: e.message, users: [], total: 0 }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
