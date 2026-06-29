// api/stripe-webhook.js
// Reçoit les évènements Stripe (paiement vérifié) et met à jour le plan dans Upstash.
// C'est la SEULE source de vérité pour un plan payant. Aucune dépendance npm :
// vérification de signature en Web Crypto, runtime edge.
export const config = { runtime: 'edge' };

const KV  = () => process.env.KV_REST_API_URL;
const TOK = () => process.env.KV_REST_API_TOKEN;

/* ── Mapping prix (centimes EUR) → plan, utilisé en repli si pas de metadata ── */
function planFromAmount(amount) {
  switch (amount) {
    case 699:   return { plan: 'premium', billing: 'monthly' };
    case 5499:  return { plan: 'premium', billing: 'yearly'  };
    case 1999:  return { plan: 'creator', billing: 'monthly' };
    case 15999: return { plan: 'creator', billing: 'yearly'  };
    default:    return null;
  }
}

/* ── Décodage base64url (l'email passé en client_reference_id) ── */
function b64urlDecode(s) {
  try {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    return atob(s);
  } catch (e) { return null; }
}

/* ── Vérification de la signature Stripe (HMAC-SHA256) ── */
async function verifyStripeSignature(rawBody, sigHeader, secret) {
  if (!sigHeader || !secret) return false;
  let t = null;
  const v1 = [];
  for (const part of sigHeader.split(',')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1);
    if (k === 't') t = v;
    else if (k === 'v1') v1.push(v);
  }
  if (!t || v1.length === 0) return false;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(`${t}.${rawBody}`));
  const expected = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('');
  return v1.some(sig => timingSafeEqual(sig, expected));
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/* ── Accès Upstash (même style REST que le reste du projet) ── */
async function kvGet(key) {
  const res = await fetch(`${KV()}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${TOK()}` },
  });
  const data = await res.json();
  return data.result ?? null;
}
async function kvSet(key, value) {
  await fetch(`${KV()}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}`, {
    headers: { Authorization: `Bearer ${TOK()}` },
  });
}

/* ── Écrit le plan dans le profil (crée un profil minimal si l'utilisateur n'existe pas encore) ── */
async function setPlan(email, plan, billing) {
  if (!email) return;
  const emailKey = email.toLowerCase().trim();
  const key = `profile:${emailKey}`;
  const raw = await kvGet(key);
  let profile = null;
  if (raw) {
    try { profile = JSON.parse(raw); if (typeof profile === 'string') profile = JSON.parse(profile); } catch (e) {}
  }
  if (!profile || typeof profile !== 'object') {
    profile = { email: emailKey, createdAt: Date.now(), _viaStripe: true };
  }
  profile.plan = plan;
  profile.billing = billing || profile.billing || 'monthly';
  profile.planActivatedAt = Date.now();
  profile.updatedAt = Date.now();
  await kvSet(key, JSON.stringify(profile));
}

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Méthode non autorisée' }), { status: 405 });
  }

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const rawBody = await req.text();
  const sig = req.headers.get('stripe-signature');

  // Signature invalide = requête potentiellement falsifiée → on refuse (pas de retry Stripe)
  if (!(await verifyStripeSignature(rawBody, sig, secret))) {
    return new Response(JSON.stringify({ error: 'Signature invalide' }), { status: 400 });
  }

  let event;
  try { event = JSON.parse(rawBody); }
  catch (e) { return new Response(JSON.stringify({ error: 'JSON invalide' }), { status: 400 }); }

  try {
    if (event.type === 'checkout.session.completed') {
      const s = event.data.object;

      // 1) Identifier QUI a payé : client_reference_id (email encodé) > email Stripe
      let email = null;
      if (s.client_reference_id) {
        const dec = b64urlDecode(s.client_reference_id);
        if (dec && dec.includes('@')) email = dec;
      }
      if (!email) email = s.customer_details?.email || s.customer_email || null;

      // 2) Identifier le plan : metadata du Payment Link > repli sur le montant
      let plan = s.metadata?.plan;
      let billing = s.metadata?.billing;
      if (!plan) {
        const fromAmt = planFromAmount(s.amount_total);
        if (fromAmt) { plan = fromAmt.plan; billing = fromAmt.billing; }
      }

      if (email && (plan === 'premium' || plan === 'creator')) {
        await setPlan(email, plan, billing);
        // Mémoriser le lien abonnement→email pour pouvoir rétrograder à l'annulation
        if (s.subscription) await kvSet(`stripe_sub:${s.subscription}`, email.toLowerCase().trim());
        if (s.customer)     await kvSet(`stripe_cust:${s.customer}`, email.toLowerCase().trim());
      }
    }

    else if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object;
      let email = await kvGet(`stripe_sub:${sub.id}`);
      if (!email && sub.customer) email = await kvGet(`stripe_cust:${sub.customer}`);
      if (email) await setPlan(email, 'free', 'monthly');
    }

    // Tout autre type d'évènement : on accuse simplement réception.
  } catch (e) {
    // Erreur de traitement (ex. Upstash indisponible) → 500 pour que Stripe réessaie.
    // Les opérations sont idempotentes, un re-essai est sans risque.
    return new Response(JSON.stringify({ error: 'Traitement échoué', detail: String(e) }), { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), { status: 200 });
}
