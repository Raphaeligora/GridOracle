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

async function kvSet(key, value) {
  const v = typeof value === 'string' ? value : JSON.stringify(value);
  const r = await fetch(`${KV()}/set/${encodeURIComponent(key)}/${encodeURIComponent(v)}`, {
    headers: { Authorization: `Bearer ${TOK()}` }
  });
  return r.ok;
}

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  let body;
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } }); }

  const { handle, email = '', inviteCode, tc = '#e8001d' } = body;

  if (!handle || !inviteCode) {
    return new Response(JSON.stringify({ error: 'Handle et code d\'invitation requis' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const code = inviteCode.toUpperCase().trim();

  // Résoudre le code → leagueId
  const leagueId = await kvGet(`invite:${code}`);
  if (!leagueId) {
    return new Response(JSON.stringify({ error: 'Code invalide — vérifie et réessaie' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  // Ligue
  const leagueRaw = await kvGet(`league:${leagueId}`);
  if (!leagueRaw) {
    return new Response(JSON.stringify({ error: 'Ligue introuvable' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }
  const league = JSON.parse(leagueRaw);

  // Membres existants
  const membersRaw = await kvGet(`league:${leagueId}:members`);
  const members = membersRaw ? JSON.parse(membersRaw) : [];

  // Déjà membre ?
  const alreadyIn = members.find(m => m.handle.toLowerCase() === handle.toLowerCase());
  if (alreadyIn) {
    return new Response(JSON.stringify({
      success: true,
      alreadyMember: true,
      league,
      members: members.sort((a, b) => (b.pts || 0) - (a.pts || 0))
    }), { headers: { 'Content-Type': 'application/json' } });
  }

  // Récupérer les points actuels du membre depuis son profil
  let currentPts = 0;
  try {
    const profileRaw = await kvGet(`profile:${email.toLowerCase()}`);
    if (profileRaw) {
      const profile = JSON.parse(profileRaw);
      currentPts = profile.points || 0;
    }
  } catch {}

  // Ajouter le membre
  members.push({ handle, email, pts: currentPts, joinedAt: Date.now(), isOwner: false, tc });

  // Mettre à jour la ligue
  league.memberCount = members.length;
  await kvSet(`league:${leagueId}:members`, members);
  await kvSet(`league:${leagueId}`, league);

  // Ajouter la ligue aux ligues du membre
  const userLeaguesRaw = await kvGet(`user:${handle}:leagues`);
  const userLeagues = userLeaguesRaw ? JSON.parse(userLeaguesRaw) : [];
  if (!userLeagues.includes(leagueId)) {
    userLeagues.push(leagueId);
    await kvSet(`user:${handle}:leagues`, userLeagues);
  }

  return new Response(JSON.stringify({
    success: true,
    league,
    members: members.sort((a, b) => (b.pts || 0) - (a.pts || 0))
  }), { headers: { 'Content-Type': 'application/json' } });
}
