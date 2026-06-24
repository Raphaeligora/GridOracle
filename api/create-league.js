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

function genCode() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += c[Math.floor(Math.random() * c.length)];
  return s.slice(0, 4) + '-' + s.slice(4);
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  let body;
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } }); }

  const { ownerHandle, ownerEmail = '', name, description = '', customCode = '' } = body;

  if (!ownerHandle || !name?.trim()) {
    return new Response(JSON.stringify({ error: 'Nom de ligue et handle requis' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const id = genId();

  // Code d'invitation : custom ou auto-généré
  let code = customCode ? customCode.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 9) : '';
  if (code.length < 4) code = genCode();

  // Vérifier unicité
  const taken = await kvGet(`invite:${code}`);
  if (taken) code = genCode();

  const league = {
    id,
    name: name.trim().slice(0, 50),
    description: description.trim().slice(0, 200),
    ownerHandle,
    ownerEmail,
    inviteCode: code,
    createdAt: Date.now(),
    memberCount: 1,
    active: true,
    gp: 'GP Autriche 2026'
  };

  const ownerMember = {
    handle: ownerHandle,
    email: ownerEmail,
    pts: 0,
    joinedAt: Date.now(),
    isOwner: true,
    tc: '#e8001d'
  };

  // Stocker ligue + membres + code
  await kvSet(`league:${id}`, league);
  await kvSet(`league:${id}:members`, [ownerMember]);
  await kvSet(`invite:${code}`, id);

  // Ajouter aux ligues du Creator
  const rawLeagues = await kvGet(`user:${ownerHandle}:leagues`);
  const leagues = rawLeagues ? JSON.parse(rawLeagues) : [];
  if (!leagues.includes(id)) leagues.push(id);
  await kvSet(`user:${ownerHandle}:leagues`, leagues);

  return new Response(JSON.stringify({ success: true, league }), {
    headers: { 'Content-Type': 'application/json' }
  });
}
