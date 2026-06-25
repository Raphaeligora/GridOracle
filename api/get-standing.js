// api/get-standings.js — Retourne les standings depuis Redis (mis à jour par update-standings)
export const config = { runtime: 'edge' };
const KV=()=>process.env.KV_REST_API_URL, TOK=()=>process.env.KV_REST_API_TOKEN;
async function kvGet(k){const r=await fetch(`${KV()}/get/${encodeURIComponent(k)}`,{headers:{Authorization:`Bearer ${TOK()}`}});return(await r.json()).result??null;}
export default async function handler(req){
  const [wdcRaw,wccRaw,gpsRaw]=await Promise.all([
    kvGet('config:wdc_standings'), kvGet('config:wcc_standings'), kvGet('config:gps_completed')
  ]);
  return new Response(JSON.stringify({
    wdc: wdcRaw?JSON.parse(wdcRaw):[],
    wcc: wccRaw?JSON.parse(wccRaw):[],
    gpsCompleted: gpsRaw?parseInt(gpsRaw):9,
    live: !!(wdcRaw)
  }),{headers:{'Content-Type':'application/json','Cache-Control':'s-maxage=300'}});
}
