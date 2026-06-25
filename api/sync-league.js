export const config = { runtime: 'edge' };
const KV=()=>process.env.KV_REST_API_URL, TOK=()=>process.env.KV_REST_API_TOKEN;
async function kvGet(k){const r=await fetch(`${KV()}/get/${encodeURIComponent(k)}`,{headers:{Authorization:`Bearer ${TOK()}`}});return(await r.json()).result??null;}
async function kvSet(k,v){const s=typeof v==='string'?v:JSON.stringify(v);await fetch(`${KV()}/set/${encodeURIComponent(k)}/${encodeURIComponent(s)}`,{headers:{Authorization:`Bearer ${TOK()}`}});}

export default async function handler(req){
  if(req.method!=='POST') return new Response('Method not allowed',{status:405});
  let b; try{b=await req.json();}catch{return new Response(JSON.stringify({error:'Invalid JSON'}),{status:400,headers:{'Content-Type':'application/json'}});}

  const{handle, email='', gp, pred=[]}=b;
  if(!handle||!gp) return new Response(JSON.stringify({error:'handle et gp requis'}),{status:400,headers:{'Content-Type':'application/json'}});

  // Récupérer les points actuels depuis le profil
  let currentPts=0;
  if(email){
    try{
      const pRaw=await kvGet(`profile:${email.toLowerCase()}`);
      if(pRaw){ const p=JSON.parse(pRaw); currentPts=p.points||0; }
    }catch{}
  }

  // Récupérer les ligues du joueur
  const idsRaw=await kvGet(`user:${handle}:leagues`);
  const leagueIds=idsRaw?JSON.parse(idsRaw):[];
  if(!leagueIds.length) return new Response(JSON.stringify({success:true,synced:0}),{headers:{'Content-Type':'application/json'}});

  // Mettre à jour chaque ligue en parallèle
  const results = await Promise.allSettled(leagueIds.map(async leagueId=>{
    const mRaw=await kvGet(`league:${leagueId}:members`);
    if(!mRaw) return;
    const members=JSON.parse(mRaw);
    const idx=members.findIndex(m=>m.handle.toLowerCase()===handle.toLowerCase());
    if(idx<0) return;

    // Mise à jour du membre
    members[idx]={
      ...members[idx],
      pts: currentPts,
      hasPredicted: true,
      lastPred: pred.slice(0,10),   // Top 10 max
      lastGP: gp,
      lastPredAt: Date.now()
    };
    await kvSet(`league:${leagueId}:members`, members);

    // Mettre à jour memberCount dans la ligue
    const lRaw=await kvGet(`league:${leagueId}`);
    if(lRaw){
      const league=JSON.parse(lRaw);
      league.memberCount=members.length;
      await kvSet(`league:${leagueId}`,league);
    }
  }));

  const synced=results.filter(r=>r.status==='fulfilled').length;
  return new Response(JSON.stringify({success:true,synced,total:leagueIds.length}),{headers:{'Content-Type':'application/json'}});
}
