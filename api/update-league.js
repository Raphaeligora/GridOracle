export const config = { runtime: 'edge' };
const KV  = () => process.env.KV_REST_API_URL;
const TOK = () => process.env.KV_REST_API_TOKEN;
async function kvGet(key) {
  const r = await fetch(`${KV()}/get/${encodeURIComponent(key)}`,{headers:{Authorization:`Bearer ${TOK()}`}});
  return (await r.json()).result ?? null;
}
async function kvSet(key, value) {
  const v = typeof value==='string'?value:JSON.stringify(value);
  const r = await fetch(`${KV()}/set/${encodeURIComponent(key)}/${encodeURIComponent(v)}`,{headers:{Authorization:`Bearer ${TOK()}`}});
  return r.ok;
}
export default async function handler(req) {
  if(req.method!=='POST') return new Response('Method not allowed',{status:405});
  let body; try{body=await req.json();}catch{return new Response(JSON.stringify({error:'Invalid JSON'}),{status:400,headers:{'Content-Type':'application/json'}});}
  const {leagueId, ownerHandle, name, description, color, icon, bannerColor} = body;
  if(!leagueId||!ownerHandle) return new Response(JSON.stringify({error:'leagueId et ownerHandle requis'}),{status:400,headers:{'Content-Type':'application/json'}});
  const raw = await kvGet(`league:${leagueId}`);
  if(!raw) return new Response(JSON.stringify({error:'Ligue introuvable'}),{status:404,headers:{'Content-Type':'application/json'}});
  const league = JSON.parse(raw);
  if(league.ownerHandle!==ownerHandle) return new Response(JSON.stringify({error:'Non autorisé'}),{status:403,headers:{'Content-Type':'application/json'}});
  if(name) league.name = name.trim().slice(0,50);
  if(description!==undefined) league.description = description.trim().slice(0,200);
  if(color) league.color = color;
  if(icon) league.icon = icon;
  if(bannerColor) league.bannerColor = bannerColor;
  await kvSet(`league:${leagueId}`, league);
  return new Response(JSON.stringify({success:true, league}),{headers:{'Content-Type':'application/json'}});
}
