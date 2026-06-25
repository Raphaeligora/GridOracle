// api/get-creator-league.js
// Trouve la ligue principale d'un creator par son handle
// GET ?handle=fanfan
export const config = { runtime: 'edge' };
const KV=()=>process.env.KV_REST_API_URL, TOK=()=>process.env.KV_REST_API_TOKEN;
async function kvGet(k){const r=await fetch(`${KV()}/get/${encodeURIComponent(k)}`,{headers:{Authorization:`Bearer ${TOK()}`}});return(await r.json()).result??null;}

export default async function handler(req){
  const url=new URL(req.url);
  const handle=url.searchParams.get('handle');
  if(!handle) return new Response(JSON.stringify({error:'handle requis'}),{status:400,headers:{'Content-Type':'application/json'}});

  const idsRaw=await kvGet(`user:${handle}:leagues`);
  if(!idsRaw) return new Response(JSON.stringify({error:'Aucune ligue trouvee pour ce creator',handle}),{status:404,headers:{'Content-Type':'application/json'}});

  const ids=JSON.parse(idsRaw);
  if(!ids.length) return new Response(JSON.stringify({error:'Aucune ligue trouvee',handle}),{status:404,headers:{'Content-Type':'application/json'}});

  // Recup toutes les ligues et trouver celle dont l'owner = handle
  const leagues=await Promise.all(ids.map(async id=>{
    const raw=await kvGet(`league:${id}`);
    return raw?JSON.parse(raw):null;
  }));

  // Priorite : ligue dont handle est l'owner, sinon la premiere
  const owned=leagues.filter(Boolean).find(l=>l.ownerHandle.toLowerCase()===handle.toLowerCase());
  const main=owned||leagues.find(Boolean);

  if(!main) return new Response(JSON.stringify({error:'Ligue introuvable',handle}),{status:404,headers:{'Content-Type':'application/json'}});

  return new Response(JSON.stringify({
    success:true, league:main, handle
  }),{headers:{'Content-Type':'application/json'}});
}
