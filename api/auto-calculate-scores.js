// api/auto-calculate-scores.js — OpenF1 + calcul automatique + sync ligues
export const config = { runtime: 'edge' };

const ADMIN_SECRET='go2026admin';
const F1_PTS=[25,18,15,12,10,8,6,4,2,1];
const OPENF1='https://api.openf1.org/v1';
const KV=()=>process.env.KV_REST_API_URL, TOK=()=>process.env.KV_REST_API_TOKEN;

async function kvGet(k){const r=await fetch(`${KV()}/get/${encodeURIComponent(k)}`,{headers:{Authorization:`Bearer ${TOK()}`}});return(await r.json()).result??null;}
async function kvSet(k,v){const s=typeof v==='string'?v:JSON.stringify(v);await fetch(`${KV()}/set/${encodeURIComponent(k)}/${encodeURIComponent(s)}`,{headers:{Authorization:`Bearer ${TOK()}`}});}

const NAME_MAP={'Verstappen':'Verstappen','Antonelli':'Antonelli','Hamilton':'Hamilton',
  'Russell':'Russell','Norris':'Norris','Piastri':'Piastri','Leclerc':'Leclerc',
  'Hadjar':'Hadjar','Gasly':'Gasly','Sainz':'Sainz','Alonso':'Alonso','Stroll':'Stroll',
  'Hulkenberg':'Hulkenberg','Bearman':'Bearman','Doohan':'Doohan','Bortoleto':'Bortoleto',
  'Lawson':'Lawson','Tsunoda':'Tsunoda','Colapinto':'Colapinto','Ocon':'Ocon'};

function calcPts(prediction,results,plan){
  const max=(plan==='premium'||plan==='creator')?10:5;
  let pts=0;
  for(let i=0;i<Math.min(max,results.length,prediction.length);i++){
    const p=(typeof prediction[i]==='string'?prediction[i]:prediction[i]?.sn||'').toLowerCase();
    if(p===results[i].toLowerCase()) pts+=F1_PTS[i]||0;
  }
  return pts;
}

// Inline refresh des ligues pour chaque joueur mis à jour
async function syncLeaguesForProfiles(updatedProfiles){
  for(const [email, profile] of updatedProfiles){
    try{
      const lidsRaw=await kvGet(`user:${profile.handle}:leagues`);
      if(!lidsRaw) continue;
      const lids=JSON.parse(lidsRaw);
      await Promise.allSettled(lids.map(async lid=>{
        const mRaw=await kvGet(`league:${lid}:members`);
        if(!mRaw) return;
        const members=JSON.parse(mRaw);
        const idx=members.findIndex(m=>m.email===email||m.handle===profile.handle);
        if(idx<0) return;
        members[idx].pts=profile.points||0;
        await kvSet(`league:${lid}:members`,members);
      }));
    }catch{}
  }
}

async function getLatestRaceResults(){
  try{
    const sessRes=await fetch(`${OPENF1}/sessions?session_type=Race&year=2026`,{headers:{Accept:'application/json'}});
    if(!sessRes.ok) throw new Error('Sessions API failed');
    const sessions=await sessRes.json();
    const now=new Date().toISOString();
    const finished=sessions.filter(s=>s.date_end&&s.date_end<now).sort((a,b)=>new Date(b.date_end)-new Date(a.date_end));
    if(!finished.length) return null;
    const session=finished[0];

    // Positions finales
    const posRes=await fetch(`${OPENF1}/position?session_key=${session.session_key}`,{headers:{Accept:'application/json'}});
    if(!posRes.ok) throw new Error('Positions API failed');
    const positions=await posRes.json();
    if(!positions.length) return null;

    // Pilotes
    const drvRes=await fetch(`${OPENF1}/drivers?session_key=${session.session_key}`,{headers:{Accept:'application/json'}});
    const drivers=drvRes.ok?await drvRes.json():[];
    const driverMap={};
    drivers.forEach(d=>{driverMap[d.driver_number]=NAME_MAP[d.last_name||'']||d.last_name||('D'+d.driver_number);});

    // Dernière position de chaque pilote
    const lastPos={};
    positions.forEach(p=>{
      if(!lastPos[p.driver_number]||new Date(p.date)>new Date(lastPos[p.driver_number].date)) lastPos[p.driver_number]=p;
    });
    const finalOrder=Object.values(lastPos).sort((a,b)=>a.position-b.position).slice(0,10).map(p=>driverMap[p.driver_number]||'Unknown');

    // Meeting info pour gpId
    let gpId='race-2026', gpName='Grand Prix 2026';
    try{
      const mRes=await fetch(`${OPENF1}/meetings?meeting_key=${session.meeting_key}`,{headers:{Accept:'application/json'}});
      if(mRes.ok){const m=await mRes.json();const meet=m[0]||{};gpId=(meet.meeting_name||'race').toLowerCase().replace(/[^a-z0-9]+/g,'-')+'-2026';gpName=meet.meeting_official_name||meet.meeting_name||'Race 2026';}
    }catch{}

    return {gpId, gpName, results:finalOrder, sessionKey:session.session_key};
  }catch(e){
    console.error('OpenF1:',e.message);
    return null;
  }
}

async function processScores(gpId, results){
  let cursor='0', allKeys=[];
  do{
    const s=await fetch(`${KV()}/scan/${cursor}/match/${encodeURIComponent('pred:*:'+gpId)}/count/200`,{headers:{Authorization:`Bearer ${TOK()}`}});
    const d=await s.json();
    const[nc,keys]=d.result||['0',[]];
    cursor=nc; allKeys.push(...(keys||[]));
  }while(cursor!=='0');
  if(!allKeys.length) return {updated:0,avgPts:0};

  let updated=0,total=0;
  const updatedProfiles=new Map();

  await Promise.allSettled(allKeys.map(async key=>{
    try{
      const email=key.split(':').slice(1,-1).join(':');
      if(!email) return;
      const predRaw=await kvGet(key);
      if(!predRaw) return;
      const pred=JSON.parse(predRaw);
      if(!Array.isArray(pred)) return;
      const pRaw=await kvGet(`profile:${email.toLowerCase()}`);
      if(!pRaw) return;
      const profile=JSON.parse(pRaw);
      const pts=calcPts(pred,results,profile.plan||'free');
      profile.points=(profile.points||0)+pts;
      if(!profile.gpHistory) profile.gpHistory={};
      profile.gpHistory[gpId]={pts,pred:pred.map(p=>typeof p==='string'?p:p?.sn||'').slice(0,10),results:results.slice(0,10),ts:Date.now()};
      await kvSet(`profile:${email.toLowerCase()}`,profile);
      updatedProfiles.set(email.toLowerCase(),profile);
      updated++; total+=pts;
    }catch{}
  }));

  // ✅ Sync pts dans toutes les ligues
  await syncLeaguesForProfiles(updatedProfiles);

  return {updated, avgPts:updated?Math.round(total/updated):0};
}

export default async function handler(req){
  const url=new URL(req.url);
  const isCron=req.headers.get('x-vercel-cron')==='1';
  if(!isCron&&url.searchParams.get('secret')!==ADMIN_SECRET)
    return new Response(JSON.stringify({error:'Unauthorized'}),{status:401,headers:{'Content-Type':'application/json'}});

  const force=url.searchParams.get('force')==='1';
  const raceData=await getLatestRaceResults();
  if(!raceData||!raceData.results.length)
    return new Response(JSON.stringify({success:false,message:'Pas de résultats OpenF1 disponibles'}),{headers:{'Content-Type':'application/json'}});

  const{gpId,gpName,results}=raceData;
  const alreadyDone=await kvGet(`config:scores_done:${gpId}`);
  if(alreadyDone&&!force)
    return new Response(JSON.stringify({success:true,message:`Déjà calculé pour ${gpId}`,results,skipped:true}),{headers:{'Content-Type':'application/json'}});

  const{updated,avgPts}=await processScores(gpId,results);
  await kvSet(`config:scores_done:${gpId}`,JSON.stringify({ts:Date.now(),results,updated}));
  await kvSet(`config:race_results:${gpId}`,JSON.stringify({gpId,gpName,results,ts:Date.now()}));

  return new Response(JSON.stringify({
    success:true,gpId,gpName,results,updated,avgPts,leaguesSynced:true,
    message:`✅ ${gpName} — ${updated} joueurs mis à jour, ligues synchronisées`
  }),{headers:{'Content-Type':'application/json'}});
}
