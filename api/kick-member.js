export const config = { runtime: 'edge' };
const KV=()=>process.env.KV_REST_API_URL, TOK=()=>process.env.KV_REST_API_TOKEN;
async function kvGet(k){const r=await fetch(`${KV()}/get/${encodeURIComponent(k)}`,{headers:{Authorization:`Bearer ${TOK()}`}});return(await r.json()).result??null;}
async function kvSet(k,v){const s=typeof v==='string'?v:JSON.stringify(v);await fetch(`${KV()}/set/${encodeURIComponent(k)}/${encodeURIComponent(s)}`,{headers:{Authorization:`Bearer ${TOK()}`}});}
export default async function handler(req){
  if(req.method!=='POST')return new Response('Method not allowed',{status:405});
  let b;try{b=await req.json();}catch{return new Response(JSON.stringify({error:'Invalid JSON'}),{status:400,headers:{'Content-Type':'application/json'}});}
  const{leagueId,ownerHandle,targetHandle}=b;
  if(!leagueId||!ownerHandle||!targetHandle)return new Response(JSON.stringify({error:'Champs requis manquants'}),{status:400,headers:{'Content-Type':'application/json'}});
  // Vérifier que le demandeur est bien le Creator
  const leagueRaw=await kvGet(`league:${leagueId}`);
  if(!leagueRaw)return new Response(JSON.stringify({error:'Ligue introuvable'}),{status:404,headers:{'Content-Type':'application/json'}});
  const league=JSON.parse(leagueRaw);
  if(league.ownerHandle.toLowerCase()!==ownerHandle.toLowerCase())return new Response(JSON.stringify({error:'Non autorisé'}),{status:403,headers:{'Content-Type':'application/json'}});
  if(targetHandle.toLowerCase()===ownerHandle.toLowerCase())return new Response(JSON.stringify({error:'Tu ne peux pas t\'expulser toi-même'}),{status:400,headers:{'Content-Type':'application/json'}});
  // Retirer de la liste membres
  const mRaw=await kvGet(`league:${leagueId}:members`);
  let members=mRaw?JSON.parse(mRaw):[];
  const before=members.length;
  members=members.filter(m=>m.handle.toLowerCase()!==targetHandle.toLowerCase());
  if(members.length===before)return new Response(JSON.stringify({error:'Membre introuvable'}),{status:404,headers:{'Content-Type':'application/json'}});
  league.memberCount=members.length;
  await kvSet(`league:${leagueId}:members`,members);
  await kvSet(`league:${leagueId}`,league);
  // Retirer la ligue de la liste du membre expulsé
  const ulRaw=await kvGet(`user:${targetHandle}:leagues`);
  if(ulRaw){const ul=JSON.parse(ulRaw).filter(id=>id!==leagueId);await kvSet(`user:${targetHandle}:leagues`,ul);}
  // Message système dans le chat
  const msgRaw=await kvGet(`league:${leagueId}:messages`);
  const msgs=msgRaw?JSON.parse(msgRaw):[];
  msgs.push({id:Date.now().toString(36),handle:'Système',text:`@${targetHandle} a été expulsé de la ligue.`,tc:'#888',ts:Date.now(),isSystem:true});
  await kvSet(`league:${leagueId}:messages`,msgs);
  return new Response(JSON.stringify({success:true,memberCount:members.length}),{headers:{'Content-Type':'application/json'}});
}
