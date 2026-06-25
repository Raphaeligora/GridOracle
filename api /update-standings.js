// api/update-standings.js
// Met à jour les classements WDC/WCC depuis OpenF1 après chaque course
// GET ?secret=go2026admin
export const config = { runtime: 'edge' };

const ADMIN_SECRET='go2026admin';
const OPENF1='https://api.openf1.org/v1';
const KV=()=>process.env.KV_REST_API_URL, TOK=()=>process.env.KV_REST_API_TOKEN;
async function kvSet(k,v){const s=typeof v==='string'?v:JSON.stringify(v);await fetch(`${KV()}/set/${encodeURIComponent(k)}/${encodeURIComponent(s)}`,{headers:{Authorization:`Bearer ${TOK()}`}});}
async function kvGet(k){const r=await fetch(`${KV()}/get/${encodeURIComponent(k)}`,{headers:{Authorization:`Bearer ${TOK()}`}});return(await r.json()).result??null;}

// Mapping équipes OpenF1 → notre format
const TEAM_MAP={
  'Mercedes':'mercedes','Red Bull Racing':'redbull','Ferrari':'ferrari',
  'McLaren':'mclaren','Alpine':'alpine','Aston Martin':'aston',
  'Williams':'williams','Kick Sauber':'sauber','VCARB':'redbull',
  'Haas F1 Team':'haas'
};
const TC_MAP={
  'mercedes':'#00D2BE','redbull':'#3671C6','ferrari':'#E8001D',
  'mclaren':'#FF8000','alpine':'#FF0060','aston':'#358C75',
  'williams':'#00A0DD','sauber':'#00E701','haas':'#B6BABD'
};

export default async function handler(req){
  const url=new URL(req.url);
  const isCron=req.headers.get('x-vercel-cron')==='1';
  if(!isCron && url.searchParams.get('secret')!==ADMIN_SECRET)
    return new Response(JSON.stringify({error:'Unauthorized'}),{status:401,headers:{'Content-Type':'application/json'}});

  try{
    // Récupérer la dernière session de course
    const sessRes=await fetch(`${OPENF1}/sessions?session_type=Race&year=2026`,{headers:{'Accept':'application/json'}});
    if(!sessRes.ok) throw new Error('Sessions API failed');
    const sessions=await sessRes.json();
    const now=new Date().toISOString();
    const finished=sessions.filter(s=>s.date_end&&s.date_end<now).sort((a,b)=>new Date(b.date_end)-new Date(a.date_end));
    if(!finished.length) throw new Error('Aucune course terminée');
    const latestSession=finished[0];

    // Récupérer tous les pilotes de la session
    const drvRes=await fetch(`${OPENF1}/drivers?session_key=${latestSession.session_key}`,{headers:{'Accept':'application/json'}});
    if(!drvRes.ok) throw new Error('Drivers API failed');
    const drivers=await drvRes.json();

    // Construire WDC depuis les données pilotes (points cumulés de la saison)
    // OpenF1 ne donne pas directement les points WDC → on utilise notre calcul
    // Mais on met à jour les noms/équipes/photos au moins

    // Tenter de récupérer standings depuis Ergast (fallback si disponible)
    let wdcFromAPI=[], wccFromAPI=[];
    try{
      const ergastRes=await fetch('https://ergast.com/api/f1/2026/driverStandings.json',{headers:{'Accept':'application/json'}});
      if(ergastRes.ok){
        const ergast=await ergastRes.json();
        const standings=ergast.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings||[];
        wdcFromAPI=standings.slice(0,20).map(s=>({
          pos:parseInt(s.position),
          sn:s.Driver.familyName,
          fn:s.Driver.givenName,
          pts:parseInt(s.points),
          wins:parseInt(s.wins),
          team:s.Constructors?.[0]?.name||'',
          tc:TC_MAP[TEAM_MAP[s.Constructors?.[0]?.name||'']||'']||'#888'
        }));
        const cStandings=ergast.MRData?.StandingsTable?.StandingsLists?.[0]?.ConstructorStandings||[];
        wccFromAPI=cStandings.slice(0,10).map(s=>({
          pos:parseInt(s.position),
          name:s.Constructor.name,
          pts:parseInt(s.points),
          wins:parseInt(s.wins),
          tc:TC_MAP[TEAM_MAP[s.Constructor.name||'']||'']||'#888'
        }));
      }
    }catch{}

    // Mettre à jour dans Redis si on a des données
    if(wdcFromAPI.length){
      await kvSet('config:wdc_standings',wdcFromAPI);
      await kvSet('config:wcc_standings',wccFromAPI);
      await kvSet('config:standings_updated',JSON.stringify({ts:Date.now(),gpsCompleted:finished.length}));
    }

    // Mettre à jour le nombre de GPs joués
    await kvSet('config:gps_completed',String(finished.length));

    return new Response(JSON.stringify({
      success:true,
      gpsCompleted:finished.length,
      wdcUpdated:wdcFromAPI.length>0,
      message:`✅ Standings mis à jour — ${finished.length} GPs joués`
    }),{headers:{'Content-Type':'application/json'}});
  }catch(e){
    return new Response(JSON.stringify({success:false,error:e.message}),{headers:{'Content-Type':'application/json'}});
  }
}
