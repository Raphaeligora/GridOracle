export const config = { runtime: 'edge' };
const KV=()=>process.env.KV_REST_API_URL, TOK=()=>process.env.KV_REST_API_TOKEN;
async function kvGet(k){const r=await fetch(`${KV()}/get/${encodeURIComponent(k)}`,{headers:{Authorization:`Bearer ${TOK()}`}});return(await r.json()).result??null;}
export default async function handler(req){
  const u=new URL(req.url);
  const leagueId=u.searchParams.get('leagueId');
  const since=parseInt(u.searchParams.get('since')||'0',10);
  if(!leagueId)return new Response(JSON.stringify({error:'leagueId requis'}),{status:400,headers:{'Content-Type':'application/json'}});
  const raw=await kvGet(`league:${leagueId}:messages`);
  const all=raw?JSON.parse(raw):[];
  const msgs=since?all.filter(m=>m.ts>since):all.slice(-50);
  return new Response(JSON.stringify({messages:msgs}),{headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
}
