// api/admin-set-plan.js — endpoint admin one-shot, à supprimer après usage
export const config = { runtime: 'edge' };

const KV  = () => process.env.KV_REST_API_URL;
const TOK = () => process.env.KV_REST_API_TOKEN;
// Secret à changer si besoin — correspond au param ?secret= dans l'URL
const ADMIN_SECRET = 'go2026admin';

async function kvGet(key) {
  const r = await fetch(`${KV()}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${TOK()}` }
  });
  return (await r.json()).result ?? null;
}

async function kvSet(key, value) {
  const v = typeof value === 'string' ? value : JSON.stringify(value);
  const r = await fetch(`${KV()}/set/${encodeURIComponent(key)}/${encodeURIComponent(v)}`, {
    headers: { Authorization: `Bearer ${TOK()}` }
  });
  return r.ok;
}

export default async function handler(req) {
  const url    = new URL(req.url);
  const secret = url.searchParams.get('secret');
  const email  = url.searchParams.get('email');
  const plan   = url.searchParams.get('plan') || 'creator';
  const billing= url.searchParams.get('billing') || 'yearly';

  if (secret !== ADMIN_SECRET) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  if (!email) {
    return new Response(JSON.stringify({ error: 'email requis' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const key = `profile:${email.toLowerCase()}`;
  const raw = await kvGet(key);

  if (!raw) {
    return new Response(JSON.stringify({ error: `Profil introuvable pour ${email}` }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  const profile = JSON.parse(raw);
  profile.plan    = plan;
  profile.billing = billing;

  await kvSet(key, profile);

  return new Response(JSON.stringify({
    success: true,
    email,
    plan,
    billing,
    handle: profile.handle || '?',
    message: `✅ ${email} → plan ${plan} (${billing})`
  }), { headers: { 'Content-Type': 'application/json' } });
}
