export const config = { runtime: 'edge' };
const KV=()=>process.env.KV_REST_API_URL, TOK=()=>process.env.KV_REST_API_TOKEN;
async function kvGet(k){const r=await fetch(`${KV()}/get/${encodeURIComponent(k)}`,{headers:{Authorization:`Bearer ${TOK()}`}});return(await r.json()).result??null;}
async function kvSet(k,v){const s=typeof v==='string'?v:JSON.stringify(v);await fetch(`${KV()}/set/${encodeURIComponent(k)}/${encodeURIComponent(s)}`,{headers:{Authorization:`Bearer ${TOK()}`}});}

export default async function handler(req){
  if(req.method!=='POST') return new Response('Method not allowed',{status:405});
  let b; try{b=await req.json();}catch{return new Response(JSON.stringify({error:'Invalid JSON'}),{status:400,headers:{'Content-Type':'application/json'}});}
  const{handle,email='',inviteCode,tc='#e8001d'}=b;
  if(!handle||!inviteCode) return new Response(JSON.stringify({error:"Handle et code d'invitation requis"}),{status:400,headers:{'Content-Type':'application/json'}});

  const code=inviteCode.toUpperCase().trim();
  const leagueId=await kvGet(`invite:${code}`);
  if(!leagueId) return new Response(JSON.stringify({error:'Code invalide ou ligue introuvable'}),{status:404,headers:{'Content-Type':'application/json'}});

  const leagueRaw=await kvGet(`league:${leagueId}`);
  if(!leagueRaw) return new Response(JSON.stringify({error:'Ligue introuvable'}),{status:404,headers:{'Content-Type':'application/json'}});
  const league=JSON.parse(leagueRaw);

  const membersRaw=await kvGet(`league:${leagueId}:members`);
  const members=membersRaw?JSON.parse(membersRaw):[];

  // Deja membre ?
  const already=members.find(m=>m.handle.toLowerCase()===handle.toLowerCase());
  if(already){
    return new Response(JSON.stringify({
      success:true, alreadyMember:true, league,
      members:members.sort((a,b)=>(b.pts||0)-(a.pts||0))
    }),{headers:{'Content-Type':'application/json'}});
  }

  // Points actuels du profil
  let currentPts=0;
  if(email){
    try{const pRaw=await kvGet(`profile:${email.toLowerCase()}`);if(pRaw)currentPts=JSON.parse(pRaw).points||0;}catch{}
  }

  // Ajouter le membre
  members.push({handle,email,pts:currentPts,joinedAt:Date.now(),isOwner:false,tc});
  league.memberCount=members.length;

  await kvSet(`league:${leagueId}:members`,members);
  await kvSet(`league:${leagueId}`,league);

  // Ligues du membre
  const ulRaw=await kvGet(`user:${handle}:leagues`);
  const ul=ulRaw?JSON.parse(ulRaw):[];
  if(!ul.includes(leagueId)){ul.push(leagueId);await kvSet(`user:${handle}:leagues`,ul);}

  // Message auto dans le chat (Point 3)
  const msgRaw=await kvGet(`league:${leagueId}:messages`);
  const msgs=msgRaw?JSON.parse(msgRaw):[];
  msgs.push({id:Date.now().toString(36)+Math.random().toString(36).slice(2,4),handle:'Système',text:`@${handle} a rejoint la ligue ! 🏁 Bienvenue !`,tc:'#4caf50',ts:Date.now(),isSystem:true});
  if(msgs.length>500)msgs.splice(0,msgs.length-500);
  await kvSet(`league:${leagueId}:messages`,msgs);

  return new Response(JSON.stringify({
    success:true, league,
    members:members.sort((a,b)=>(b.pts||0)-(a.pts||0))
  }),{headers:{'Content-Type':'application/json'}});
}
