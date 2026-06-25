export const config = { runtime: 'edge' };
const KV=()=>process.env.KV_REST_API_URL, TOK=()=>process.env.KV_REST_API_TOKEN;
async function kvGet(k){const r=await fetch(`${KV()}/get/${encodeURIComponent(k)}`,{headers:{Authorization:`Bearer ${TOK()}`}});return(await r.json()).result??null;}
async function kvSet(k,v){const s=typeof v==='string'?v:JSON.stringify(v);await fetch(`${KV()}/set/${encodeURIComponent(k)}/${encodeURIComponent(s)}`,{headers:{Authorization:`Bearer ${TOK()}`}});}
export default async function handler(req){
  if(req.method!=='POST')return new Response('Method not allowed',{status:405});
  let b;try{b=await req.json();}catch{return new Response(JSON.stringify({error:'Invalid JSON'}),{status:400,headers:{'Content-Type':'application/json'}});}
  const{leagueId,handle,text,tc='#e8001d'}=b;
  if(!leagueId||!handle||!text?.trim())return new Response(JSON.stringify({error:'Champs requis manquants'}),{status:400,headers:{'Content-Type':'application/json'}});
  const txt=text.trim().slice(0,500);
  // Vérifier que le handle est membre de la ligue
  const mRaw=await kvGet(`league:${leagueId}:members`);
  const members=mRaw?JSON.parse(mRaw):[];
  const member=members.find(m=>m.handle.toLowerCase()===handle.toLowerCase());
  if(!member)return new Response(JSON.stringify({error:'Tu ne fais pas partie de cette ligue'}),{status:403,headers:{'Content-Type':'application/json'}});
  // Récupérer les messages existants
  const msgRaw=await kvGet(`league:${leagueId}:messages`);
  const msgs=msgRaw?JSON.parse(msgRaw):[];
  const msg={id:Date.now().toString(36)+Math.random().toString(36).slice(2,5),handle,text:txt,tc:member.tc||tc,ts:Date.now(),isOwner:member.isOwner||false};
  msgs.push(msg);
  // Garder les 500 derniers messages
  if(msgs.length>500)msgs.splice(0,msgs.length-500);
  await kvSet(`league:${leagueId}:messages`,msgs);
  return new Response(JSON.stringify({success:true,message:msg}),{headers:{'Content-Type':'application/json'}});
}
