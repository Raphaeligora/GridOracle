// api/send-message.js
// Envoie un message dans le chat d'une ligue
// Validation : handle OU email doit matcher un membre de la ligue
export const config = { runtime: 'edge' };

const KV  = () => process.env.KV_REST_API_URL;
const TOK = () => process.env.KV_REST_API_TOKEN;

async function kvGet(key) {
  const r = await fetch(`${KV()}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${TOK()}` }
  });
  return (await r.json()).result ?? null;
}

async function kvSet(key, value) {
  const v = typeof value === 'string' ? value : JSON.stringify(value);
  await fetch(`${KV()}/set/${encodeURIComponent(key)}/${encodeURIComponent(v)}`, {
    headers: { Authorization: `Bearer ${TOK()}` }
  });
}

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  let body;
  try { body = await req.json(); }
  catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400, headers: { 'Content-Type': 'application/json' }
    });
  }

  const { leagueId, handle, email = '', text, tc = '#e8001d' } = body;

  if (!leagueId || !handle || !text?.trim()) {
    return new Response(JSON.stringify({ error: 'leagueId, handle et text requis' }), {
      status: 400, headers: { 'Content-Type': 'application/json' }
    });
  }

  const txt = text.trim().slice(0, 500);

  // Charger les membres de la ligue
  const mRaw = await kvGet(`league:${leagueId}:members`);
  const members = mRaw ? JSON.parse(mRaw) : [];

  // Valider que le handle OU l'email est bien membre
  // Fallback email important si le handle a changé ou ne match pas exactement
  const member = members.find(m =>
    m.handle.toLowerCase() === handle.toLowerCase() ||
    (email && m.email && m.email.toLowerCase() === email.toLowerCase())
  );

  if (!member) {
    return new Response(JSON.stringify({
      error: 'Tu ne fais pas partie de cette ligue',
      debug: `handle=${handle} email=${email} members=${members.length}`
    }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  // Charger les messages existants
  const msgRaw = await kvGet(`league:${leagueId}:messages`);
  const msgs = msgRaw ? JSON.parse(msgRaw) : [];

  // Construire le message
  const msg = {
    id:      Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    handle:  member.handle,  // Utiliser le handle stocké dans la ligue (canonical)
    email:   member.email || email,
    text:    txt,
    tc:      member.tc || tc,
    ts:      Date.now(),
    isOwner: member.isOwner || false,
    isSystem: false
  };

  msgs.push(msg);
  if (msgs.length > 500) msgs.splice(0, msgs.length - 500);
  await kvSet(`league:${leagueId}:messages`, msgs);

  return new Response(JSON.stringify({ success: true, message: msg }), {
    headers: { 'Content-Type': 'application/json' }
  });
}
