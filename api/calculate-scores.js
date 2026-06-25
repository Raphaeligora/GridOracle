// api/calculate-scores.js — Calcule les points + met à jour les ligues
export const config = { runtime: 'edge' };

const ADMIN_SECRET = 'go2026admin';
const F1_PTS = [25,18,15,12,10,8,6,4,2,1];
const KV=()=>process.env.KV_REST_API_URL, TOK=()=>process.env.KV_REST_API_TOKEN;

async function kvGet(k){const r=await fetch(`${KV()}/get/${encodeURIComponent(k)}`,{headers:{Authorization:`Bearer ${TOK()}`}});return(await r.json()).result??null;}
async function kvSet(k,v){const s=typeof v==='string'?v:JSON.stringify(v);await fetch(`${KV()}/set/${encodeURIComponent(k)}/${encodeURIComponent(s)}`,{headers:{Authorization:`Bearer ${TOK()}`}});}

function calcPts(prediction, results, plan){
  const maxPos=(plan==='premium'||plan==='creator')?10:5;
  let pts=0;
  for(let i=0;i<Math.min(maxPos,results.length,prediction.length);i++){
    const pred=(typeof prediction[i]==='string'?prediction[i]:prediction[i]?.sn||'').toLowerCase();
    if(pred===results[i].toLowerCase()) pts+=F1_PTS[i]||0;
  }
  return pts;
}

// Sync les points de tous les membres de toutes les ligues depuis leurs profils
async function refreshAllLeagueScores(updatedProfiles){
  // updatedProfiles = Map email → {points}
  // Récupérer tous les handles des profils mis à jour
  for(const [email, profile] of updatedProfiles){
    try{
      const lidsRaw = await kvGet(`user:${profile.handle}:leagues`);
      if(!lidsRaw) continue;
      const lids = JSON.parse(lidsRaw);
      await Promise.allSettled(lids.map(async lid=>{
        const mRaw = await kvGet(`league:${lid}:members`);
        if(!mRaw) return;
        const members = JSON.parse(mRaw);
        const idx = members.findIndex(m=>m.email===email || m.handle===profile.handle);
        if(idx<0) return;
        members[idx].pts = profile.points||0;
        await kvSet(`league:${lid}:members`, members);
      }));
    }catch{}
  }
}

export default async function handler(req){
  const url=new URL(req.url);
  let secret, gpId, results=[];

  if(req.method==='POST'){
    let b; try{b=await req.json();}catch{return new Response(JSON.stringify({error:'Invalid JSON'}),{status:400,headers:{'Content-Type':'application/json'}});}
    secret=b.secret; gpId=b.gpId; results=b.results||[];
  } else {
    secret=url.searchParams.get('secret');
    gpId=url.searchParams.get('gpId');
    for(let i=1;i<=10;i++){const p=url.searchParams.get('p'+i);if(p)results.push(p);else break;}
  }

  if(secret!==ADMIN_SECRET) return new Response(JSON.stringify({error:'Unauthorized'}),{status:401,headers:{'Content-Type':'application/json'}});
  if(!gpId||!results.length) return new Response(JSON.stringify({error:'gpId et p1 requis'}),{status:400,headers:{'Content-Type':'application/json'}});

  // 1. Scanner toutes les prédictions pour ce GP
  let cursor='0', allKeys=[];
  do{
    const s=await fetch(`${KV()}/scan/${cursor}/match/${encodeURIComponent('pred:*:'+gpId)}/count/200`,{headers:{Authorization:`Bearer ${TOK()}`}});
    const d=await s.json();
    const[nc,keys]=d.result||['0',[]];
    cursor=nc; allKeys.push(...(keys||[]));
  }while(cursor!=='0');

  if(!allKeys.length)
    return new Response(JSON.stringify({success:true,message:'Aucune prédiction trouvée',gpId,results,updated:0}),{headers:{'Content-Type':'application/json'}});

  // 2. Calculer et sauvegarder les points
  let updated=0, totalPts=0;
  const details=[];
  const updatedProfiles = new Map(); // email → profile mis à jour

  await Promise.allSettled(allKeys.map(async key=>{
    try{
      const email=key.split(':').slice(1,-1).join(':');
      if(!email) return;
      const predRaw=await kvGet(key);
      if(!predRaw) return;
      const pred=JSON.parse(predRaw);
      if(!Array.isArray(pred)) return;
      const pRaw=await kvGet(`profile:${email.toLowerCase()}`);
      if(!pRaw) return;
      const profile=JSON.parse(pRaw);
      const gpPts=calcPts(pred,results,profile.plan||'free');
      profile.points=(profile.points||0)+gpPts;
      if(!profile.gpHistory) profile.gpHistory={};
      profile.gpHistory[gpId]={pts:gpPts,pred:pred.map(p=>typeof p==='string'?p:p?.sn||'').slice(0,10),results:results.slice(0,10),ts:Date.now()};
      await kvSet(`profile:${email.toLowerCase()}`,profile);
      updatedProfiles.set(email.toLowerCase(), profile);
      updated++; totalPts+=gpPts;
      details.push({email,handle:profile.handle,gpPts,totalPts:profile.points});
    }catch{}
  }));

  // 3. ✅ Sync les pts dans toutes les ligues de chaque joueur
  await refreshAllLeagueScores(updatedProfiles);

  return new Response(JSON.stringify({
    success:true, gpId, results, updated,
    avgPts:updated?Math.round(totalPts/updated):0,
    leaguesSynced:true,
    top:details.sort((a,b)=>b.gpPts-a.gpPts).slice(0,5),
    message:`✅ ${updated} joueurs mis à jour + ligues synchronisées`
  }),{headers:{'Content-Type':'application/json'}});
}
