// api/stripe-webhook.js
// Ecoute les evenements Stripe pour mettre a jour les plans automatiquement
// Variable d'environnement requise : STRIPE_WEBHOOK_SECRET
export const config = { runtime: 'edge' };
const KV=()=>process.env.KV_REST_API_URL, TOK=()=>process.env.KV_REST_API_TOKEN;
async function kvGet(k){const r=await fetch(`${KV()}/get/${encodeURIComponent(k)}`,{headers:{Authorization:`Bearer ${TOK()}`}});return(await r.json()).result??null;}
async function kvSet(k,v){const s=typeof v==='string'?v:JSON.stringify(v);await fetch(`${KV()}/set/${encodeURIComponent(k)}/${encodeURIComponent(s)}`,{headers:{Authorization:`Bearer ${TOK()}`}});}

// Verification signature Stripe via HMAC-SHA256 (Web Crypto API)
async function verifyStripeSignature(rawBody,sigHeader,secret){
  try{
    const parts=sigHeader.split(',');
    const t=parts.find(p=>p.startsWith('t=')).slice(2);
    const v1=parts.find(p=>p.startsWith('v1=')).slice(3);
    const payload=`${t}.${rawBody}`;
    const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
    const sig=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(payload));
    const computed=Array.from(new Uint8Array(sig)).map(b=>b.toString(16).padStart(2,'0')).join('');
    return computed===v1;
  }catch{return false;}
}

// Mapping montant Stripe → plan
function getPlanFromAmount(amountCents){
  // Premium mensuel : ~699 | Premium annuel : ~5499
  // Creator mensuel : ~1999 | Creator annuel : ~15999
  if(amountCents<=700) return {plan:'premium',billing:'monthly'};
  if(amountCents<=5500) return {plan:'premium',billing:'yearly'};
  if(amountCents<=2000) return {plan:'creator',billing:'monthly'};
  return {plan:'creator',billing:'yearly'};
}

// Mapping price ID → plan (plus fiable si configurable)
function getPlanFromPriceId(priceId){
  const map={
    'price_premium_monthly':{plan:'premium',billing:'monthly'},
    'price_premium_yearly': {plan:'premium',billing:'yearly'},
    'price_creator_monthly':{plan:'creator',billing:'monthly'},
    'price_creator_yearly': {plan:'creator',billing:'yearly'},
  };
  return map[priceId]||null;
}

async function updateUserPlan(email,plan,billing){
  if(!email) return false;
  const key=`profile:${email.toLowerCase()}`;
  const raw=await kvGet(key);
  if(!raw) return false;
  const profile=JSON.parse(raw);
  profile.plan=plan; profile.billing=billing;
  await kvSet(key,profile);
  return true;
}

export default async function handler(req){
  if(req.method!=='POST') return new Response('Method not allowed',{status:405});

  const sig=req.headers.get('stripe-signature');
  const webhookSecret=process.env.STRIPE_WEBHOOK_SECRET;
  if(!sig||!webhookSecret)
    return new Response(JSON.stringify({error:'Missing signature or secret'}),{status:400,headers:{'Content-Type':'application/json'}});

  const rawBody=await req.text();
  const isValid=await verifyStripeSignature(rawBody,sig,webhookSecret);
  if(!isValid)
    return new Response(JSON.stringify({error:'Invalid signature'}),{status:400,headers:{'Content-Type':'application/json'}});

  let event;
  try{event=JSON.parse(rawBody);}
  catch{return new Response(JSON.stringify({error:'Invalid JSON'}),{status:400,headers:{'Content-Type':'application/json'}});}

  const type=event.type;
  let result={handled:false,type};

  try{
    if(type==='checkout.session.completed'){
      const session=event.data.object;
      const email=session.customer_email||session.customer_details?.email;
      const amount=session.amount_total||0;
      const priceId=session.line_items?.data?.[0]?.price?.id;
      const {plan,billing}=getPlanFromPriceId(priceId)||getPlanFromAmount(amount);
      const ok=await updateUserPlan(email,plan,billing);
      result={handled:true,type,email,plan,billing,updated:ok};
    }
    else if(type==='customer.subscription.created'||type==='customer.subscription.updated'){
      const sub=event.data.object;
      const email=sub.customer_email;
      const priceId=sub.items?.data?.[0]?.price?.id;
      const amount=sub.items?.data?.[0]?.price?.unit_amount||0;
      const interval=sub.items?.data?.[0]?.price?.recurring?.interval;
      const {plan}=getPlanFromPriceId(priceId)||getPlanFromAmount(amount);
      const billing=interval==='year'?'yearly':'monthly';
      const ok=await updateUserPlan(email,plan,billing);
      result={handled:true,type,email,plan,billing,updated:ok};
    }
    else if(type==='customer.subscription.deleted'||type==='invoice.payment_failed'){
      const obj=event.data.object;
      const email=obj.customer_email;
      if(email){const ok=await updateUserPlan(email,'free','');result={handled:true,type,email,plan:'free',updated:ok};}
    }
  }catch(e){
    return new Response(JSON.stringify({error:e.message,type}),{status:500,headers:{'Content-Type':'application/json'}});
  }

  return new Response(JSON.stringify({received:true,...result}),{headers:{'Content-Type':'application/json'}});
}
