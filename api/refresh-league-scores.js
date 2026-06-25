// api/refresh-league-scores.js
// Appeler apres chaque course pour mettre a jour les pts de tous les membres
// GET ?secret=go2026admin ou ?secret=go2026admin&leagueId=xxx (optionnel : cibler une ligue)
export const config = { runtime: 'edge' };
const ADMIN_SECRET='go2026admin';
const KV=()=>process.env.KV_REST_API_URL, TOK=()=>process.env.KV_REST_API_TOKEN;
async function kvGet(k){const r=await fetch(`${KV()}/get/${encodeURIComponent(k)}`,{headers:{Authorization:`Bearer ${TOK()}`}});return(await r.json()).result??null;}
async function kvSet(k,v){const s=typeof v==='string'?v:JSON.stringify(v);await fetch(`${KV()}/set/${encodeURIComponent(k)}/${encodeURIComponent(s)}`,{headers:{Authorization:`Bearer ${TOK()}`}});}

async function refreshLeague(leagueId){
  const mRaw=await kvGet(`league:${leagueId}:members`);
  if(!mRaw) return {leagueId, updated:0, error:'Membres introuvables'};
  const members=JSON.parse(mRaw);
  let updated=0;

  const refreshed=await Promise.all(members.map(async m=>{
    if(!m.email) return m;
    try{
      const pRaw=await kvGet(`profile:${m.email.toLowerCase()}`);
      if(pRaw){
        const p=JSON.parse(pRaw);
        const newPts=p.points||0;
        if(newPts!==m.pts){ updated++; return {...m,pts:newPts}; }
      }
    }catch{}
    return m;
  }));

  if(updated>0){
    await kvSet(`league:${leagueId}:members`,refreshed);
    // Mise a jour memberCount
    const lRaw=await kvGet(`league:${leagueId}`);
    if(lRaw){const l=JSON.parse(lRaw);l.memberCount=refreshed.length;await kvSet(`league:${leagueId}`,l);}
  }
  return {leagueId, updated};
}

export default async function handler(req){
  const url=new URL(req.url);
  if(url.searchParams.get('secret')!==ADMIN_SECRET)
    return new Response(JSON.stringify({error:'Unauthorized'}),{status:401,headers:{'Content-Type':'application/json'}});

  const targetLeagueId=url.searchParams.get('leagueId');

  // Mode : une seule ligue
  if(targetLeagueId){
    const result=await refreshLeague(targetLeagueId);
    return new Response(JSON.stringify({success:true,results:[result]}),{headers:{'Content-Type':'application/json'}});
  }

  // Mode : toutes les ligues actives (scan par batch)
  // On recup toutes les ligues en cherchant les cles league:*:members
  // Via Upstash SCAN
  const scanUrl=`${KV()}/scan/0/match/${encodeURIComponent('invite:*')}/count/1000`;
  const scanRes=await fetch(scanUrl,{headers:{Authorization:`Bearer ${TOK()}`}});
  const scanData=await scanRes.json();
  const inviteKeys=(scanData.result?.[1]||[]);

  // Extraire les leagueIds uniques depuis les cles invite:*
  const leagueIdsSet=new Set();
  await Promise.all(inviteKeys.map(async key=>{
    const raw=await kvGet(key);
    if(raw&&typeof raw==='string') leagueIdsSet.add(raw);
  }));

  const leagueIds=[...leagueIdsSet];
  if(!leagueIds.length)
    return new Response(JSON.stringify({success:true,message:'Aucune ligue trouvee',results:[]}),{headers:{'Content-Type':'application/json'}});

  const results=await Promise.allSettled(leagueIds.map(id=>refreshLeague(id)));
  const summary=results.map((r,i)=>r.status==='fulfilled'?r.value:{leagueId:leagueIds[i],error:r.reason?.message});

  return new Response(JSON.stringify({
    success:true,
    total:leagueIds.length,
    results:summary
  }),{headers:{'Content-Type':'application/json'}});
}
