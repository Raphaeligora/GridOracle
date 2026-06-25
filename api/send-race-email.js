// api/send-race-email.js
// Envoie les emails automatiques via Brevo selon le moment de la semaine
// GET ?secret=go2026admin&type=thursday|saturday|results
// Variable d'env requise : BREVO_API_KEY
export const config = { runtime: 'edge' };

const ADMIN_SECRET='go2026admin';
const KV=()=>process.env.KV_REST_API_URL, TOK=()=>process.env.KV_REST_API_TOKEN;
const BREVO_API='https://api.brevo.com/v3/smtp/email';

async function kvGet(k){const r=await fetch(`${KV()}/get/${encodeURIComponent(k)}`,{headers:{Authorization:`Bearer ${TOK()}`}});return(await r.json()).result??null;}

// Récupère tous les emails des profils (via scan)
async function getAllEmails(){
  let cursor='0', emails=[];
  do{
    const s=await fetch(`${KV()}/scan/${cursor}/match/${encodeURIComponent('profile:*')}/count/200`,{headers:{Authorization:`Bearer ${TOK()}`}});
    const d=await s.json();
    const[nc,keys]=d.result||['0',[]];
    cursor=nc;
    for(const key of(keys||[])){
      const raw=await kvGet(key);
      if(raw){try{const p=JSON.parse(raw);if(p.email)emails.push(p);}catch{}}
    }
  }while(cursor!=='0');
  return emails;
}

async function sendBrevoEmail(to, subject, htmlContent){
  const brevoKey=process.env.BREVO_API_KEY;
  if(!brevoKey) throw new Error('BREVO_API_KEY manquant');
  const res=await fetch(BREVO_API,{
    method:'POST',
    headers:{'Content-Type':'application/json','api-key':brevoKey},
    body:JSON.stringify({
      sender:{name:'GridOracle F1',email:'noreply@gridoracle.com'},
      to:[{email:to}],
      subject,
      htmlContent
    })
  });
  return res.ok;
}

function buildThursdayEmail(profile, gpName, gpFlag){
  return `<!DOCTYPE html><html><body style="background:#07070e;color:#fff;font-family:sans-serif;padding:2rem;max-width:600px;margin:0 auto">
    <div style="background:#e8001d;height:4px;border-radius:2px;margin-bottom:1.5rem"></div>
    <h2 style="font-size:1.4rem;margin-bottom:.5rem">🏎️ ${gpFlag} ${gpName} — Les prédictions sont ouvertes !</h2>
    <p style="color:rgba(255,255,255,.6);font-size:.95rem;line-height:1.6">Salut ${profile.fn||'pilote'} 👋<br><br>
    L'IA GridOracle a publié sa prédiction pour le <strong style="color:#fff">${gpName}</strong>. Tu as <strong style="color:#e8001d">jusqu'au samedi</strong> pour soumettre la tienne.<br><br>
    Tu peux modifier ta prédiction autant de fois que tu veux avant le verrouillage aux qualifications.</p>
    <a href="https://gridoracle.vercel.app" style="display:inline-block;background:#e8001d;color:#fff;text-decoration:none;padding:.75rem 1.5rem;border-radius:8px;font-weight:700;margin-top:1rem">Prédire maintenant →</a>
    <p style="color:rgba(255,255,255,.3);font-size:.75rem;margin-top:2rem">GridOracle · <a href="https://gridoracle.vercel.app" style="color:#e8001d">gridoracle.vercel.app</a></p>
  </body></html>`;
}

function buildSaturdayEmail(profile, gpName, gpFlag){
  return `<!DOCTYPE html><html><body style="background:#07070e;color:#fff;font-family:sans-serif;padding:2rem;max-width:600px;margin:0 auto">
    <div style="background:#e8001d;height:4px;border-radius:2px;margin-bottom:1.5rem"></div>
    <h2 style="font-size:1.4rem;margin-bottom:.5rem">⏰ ${gpFlag} Dernière chance — Qualifications ce soir !</h2>
    <p style="color:rgba(255,255,255,.6);font-size:.95rem;line-height:1.6">Salut ${profile.fn||'pilote'} 👋<br><br>
    Les qualifications du <strong style="color:#fff">${gpName}</strong> commencent aujourd'hui. Dès le 1er tour : <strong style="color:#e8001d">verrouillage automatique</strong>.<br><br>
    Si tu n'as pas encore soumis ta prédiction, c'est maintenant ou jamais !</p>
    <a href="https://gridoracle.vercel.app" style="display:inline-block;background:#e8001d;color:#fff;text-decoration:none;padding:.75rem 1.5rem;border-radius:8px;font-weight:700;margin-top:1rem">Soumettre ma prédiction →</a>
    <p style="color:rgba(255,255,255,.3);font-size:.75rem;margin-top:2rem">GridOracle · <a href="https://gridoracle.vercel.app" style="color:#e8001d">gridoracle.vercel.app</a></p>
  </body></html>`;
}

function buildResultsEmail(profile, gpName, gpFlag, gpPts, totalPts, position){
  const beat=gpPts>0;
  return `<!DOCTYPE html><html><body style="background:#07070e;color:#fff;font-family:sans-serif;padding:2rem;max-width:600px;margin:0 auto">
    <div style="background:#e8001d;height:4px;border-radius:2px;margin-bottom:1.5rem"></div>
    <h2 style="font-size:1.4rem;margin-bottom:.5rem">${gpFlag} Résultats ${gpName}</h2>
    <div style="background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:1.2rem;margin:1rem 0">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem">
        <div><div style="font-size:.75rem;color:rgba(255,255,255,.4);text-transform:uppercase;letter-spacing:.1em">Ton score ce GP</div>
          <div style="font-size:2rem;font-weight:700;color:${beat?'#4caf50':'#e8001d'}">${gpPts} pts</div></div>
        <div><div style="font-size:.75rem;color:rgba(255,255,255,.4);text-transform:uppercase;letter-spacing:.1em">Total saison</div>
          <div style="font-size:2rem;font-weight:700">${totalPts} pts</div></div>
      </div>
      ${position?`<div style="margin-top:.8rem;font-size:.85rem;color:rgba(255,255,255,.5)">Classement mondial : <strong style="color:#fff">#${position}</strong></div>`:''}
    </div>
    <a href="https://gridoracle.vercel.app" style="display:inline-block;background:#e8001d;color:#fff;text-decoration:none;padding:.75rem 1.5rem;border-radius:8px;font-weight:700;margin-top:.5rem">Voir mon classement →</a>
    <p style="color:rgba(255,255,255,.3);font-size:.75rem;margin-top:2rem">GridOracle · <a href="https://gridoracle.vercel.app" style="color:#e8001d">gridoracle.vercel.app</a></p>
  </body></html>`;
}

export default async function handler(req){
  const url=new URL(req.url);
  const isCron=req.headers.get('x-vercel-cron')==='1';
  if(!isCron && url.searchParams.get('secret')!==ADMIN_SECRET)
    return new Response(JSON.stringify({error:'Unauthorized'}),{status:401,headers:{'Content-Type':'application/json'}});

  const type=url.searchParams.get('type')||'thursday';

  // Récupérer infos GP actuel depuis Redis ou config
  const gpInfoRaw=await kvGet('config:current_gp_info');
  const gpInfo=gpInfoRaw?JSON.parse(gpInfoRaw):{name:'Prochain Grand Prix',flag:'🏁'};
  const gpName=gpInfo.name||'Grand Prix';
  const gpFlag=gpInfo.flag||'🏁';

  // Récupérer tous les profils
  const profiles=await getAllEmails();
  if(!profiles.length) return new Response(JSON.stringify({success:true,sent:0,message:'Aucun profil trouvé'}),{headers:{'Content-Type':'application/json'}});

  let sent=0, failed=0;

  if(type==='thursday'||type==='saturday'){
    // Envoi en batch à tous les utilisateurs
    const buildFn=type==='thursday'?buildThursdayEmail:buildSaturdayEmail;
    const subject=type==='thursday'
      ?`🏎️ ${gpFlag} ${gpName} — Tes prédictions sont ouvertes !`
      :`⏰ ${gpFlag} Dernière chance avant le verrouillage !`;

    await Promise.allSettled(profiles.map(async p=>{
      try{
        const html=buildFn(p,gpName,gpFlag);
        const ok=await sendBrevoEmail(p.email,subject,html);
        if(ok) sent++; else failed++;
      }catch{failed++;}
    }));
  } else if(type==='results'){
    // Email personnalisé avec score de chaque joueur
    const gpId=url.searchParams.get('gpId');
    if(!gpId) return new Response(JSON.stringify({error:'gpId requis pour results'}),{status:400,headers:{'Content-Type':'application/json'}});

    await Promise.allSettled(profiles.map(async p=>{
      try{
        const gpHistory=p.gpHistory?.[gpId];
        const gpPts=gpHistory?.pts||0;
        const totalPts=p.points||0;
        const html=buildResultsEmail(p,gpName,gpFlag,gpPts,totalPts,null);
        const ok=await sendBrevoEmail(p.email,`${gpFlag} Résultats ${gpName} — Ton score : ${gpPts} pts`,html);
        if(ok) sent++; else failed++;
      }catch{failed++;}
    }));
  }

  return new Response(JSON.stringify({
    success:true, type, gpName, sent, failed,
    message:`✅ ${sent} email(s) envoyé(s) pour ${type}`
  }),{headers:{'Content-Type':'application/json'}});
}
