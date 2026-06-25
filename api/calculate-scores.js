// api/calculate-scores.js
// Calcule les points de tous les joueurs apres un GP
// POST { secret, gpId, results: ['Pilote1','Pilote2',...,'Pilote10'] }
// OU GET ?secret=go2026admin&gpId=austria-2026&p1=Verstappen&p2=Antonelli...&p10=Sainz
export const config = { runtime: 'edge' };

const ADMIN_SECRET = 'go2026admin';
const F1_PTS = [25,18,15,12,10,8,6,4,2,1];
const KV=()=>process.env.KV_REST_API_URL, TOK=()=>process.env.KV_REST_API_TOKEN;

async function kvGet(k){
  const r=await fetch(`${KV()}/get/${encodeURIComponent(k)}`,{headers:{Authorization:`Bearer ${TOK()}`}});
  return(await r.json()).result??null;
}
async function kvSet(k,v){
  const s=typeof v==='string'?v:JSON.stringify(v);
  await fetch(`${KV()}/set/${encodeURIComponent(k)}/${encodeURIComponent(s)}`,{headers:{Authorization:`Bearer ${TOK()}`}});
}

// Calcul des points pour une prédiction vs résultats officiels
function calcPts(prediction, results, plan){
  const maxPos = (plan==='premium'||plan==='creator') ? 10 : 5;
  let pts = 0;
  for(let i=0; i<Math.min(maxPos, results.length, prediction.length); i++){
    const pred = (typeof prediction[i]==='string' ? prediction[i] : prediction[i]?.sn || '').toLowerCase();
    const real = results[i].toLowerCase();
    if(pred === real) pts += F1_PTS[i] || 0;
  }
  return pts;
}

export default async function handler(req){
  const url = new URL(req.url);
  let secret, gpId, results=[];

  if(req.method==='POST'){
    let b; try{b=await req.json();}catch{return new Response(JSON.stringify({error:'Invalid JSON'}),{status:400,headers:{'Content-Type':'application/json'}});}
    secret=b.secret; gpId=b.gpId; results=b.results||[];
  } else {
    secret = url.searchParams.get('secret');
    gpId   = url.searchParams.get('gpId');
    for(let i=1;i<=10;i++){
      const p=url.searchParams.get('p'+i);
      if(p) results.push(p); else break;
    }
  }

  if(secret!==ADMIN_SECRET) return new Response(JSON.stringify({error:'Unauthorized'}),{status:401,headers:{'Content-Type':'application/json'}});
  if(!gpId||results.length<1) return new Response(JSON.stringify({error:'gpId et au moins p1 requis'}),{status:400,headers:{'Content-Type':'application/json'}});

  // 1. Scanner toutes les prédictions pour ce GP
  let cursor='0', allPredKeys=[];
  do {
    const scanRes=await fetch(`${KV()}/scan/${cursor}/match/${encodeURIComponent('pred:*:'+gpId)}/count/200`,{headers:{Authorization:`Bearer ${TOK()}`}});
    const scanData=await scanRes.json();
    const [nextCursor, keys] = scanData.result||['0',[]];
    cursor=nextCursor;
    allPredKeys.push(...(keys||[]));
  } while(cursor!=='0');

  if(!allPredKeys.length){
    return new Response(JSON.stringify({success:true,message:'Aucune prédiction trouvée pour ce GP',gpId,results,updated:0}),{headers:{'Content-Type':'application/json'}});
  }

  // 2. Calculer et enregistrer les points pour chaque joueur
  let updated=0, totalPts=0;
  const details=[];

  await Promise.allSettled(allPredKeys.map(async key=>{
    try{
      // Format clé: pred:{email}:{gpId}
      const parts = key.split(':');
      const email = parts.slice(1,-1).join(':'); // email peut contenir des :
      if(!email) return;

      // Récupérer la prédiction
      const predRaw = await kvGet(key);
      if(!predRaw) return;
      let pred;
      try{ pred=JSON.parse(predRaw); }catch{ return; }
      if(!Array.isArray(pred)) return;

      // Récupérer le profil du joueur
      const profileRaw = await kvGet(`profile:${email.toLowerCase()}`);
      if(!profileRaw) return;
      const profile = JSON.parse(profileRaw);

      // Calculer les points
      const gpPts = calcPts(pred, results, profile.plan||'free');

      // Ajouter les points au total de la saison
      const prevPts = profile.points || 0;
      profile.points = prevPts + gpPts;

      // Stocker le résultat GP dans l'historique
      if(!profile.gpHistory) profile.gpHistory = {};
      profile.gpHistory[gpId] = { pts: gpPts, pred: pred.map(p=>typeof p==='string'?p:p?.sn||'').slice(0,10), results: results.slice(0,10), ts: Date.now() };

      await kvSet(`profile:${email.toLowerCase()}`, profile);
      updated++;
      totalPts += gpPts;
      details.push({email, handle:profile.handle, gpPts, totalPts:profile.points});
    }catch(e){
      console.error('Error processing', key, e.message);
    }
  }));

  // 3. Rafraîchir les scores dans toutes les ligues
  try{
    await fetch(`${KV().replace('/v1','')}/api/refresh-league-scores?secret=${ADMIN_SECRET}`,{method:'GET'});
  }catch{}

  return new Response(JSON.stringify({
    success: true,
    gpId,
    results,
    updated,
    avgPts: updated ? Math.round(totalPts/updated) : 0,
    top: details.sort((a,b)=>b.gpPts-a.gpPts).slice(0,5),
    message: `✅ ${updated} joueurs mis à jour pour ${gpId}`
  }),{headers:{'Content-Type':'application/json'}});
}
