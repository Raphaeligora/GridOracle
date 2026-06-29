// api/get-current-gp.js
// Retourne le GP actuel depuis KV (mis a jour par transition-gp)
export const config = { runtime: "edge" };

const KV  = () => process.env.KV_REST_API_URL;
const TOK = () => process.env.KV_REST_API_TOKEN;

async function kvGet(k) {
  const r = await fetch(`${KV()}/get/${encodeURIComponent(k)}`, {
    headers: { Authorization: `Bearer ${TOK()}` },
  });
  return (await r.json()).result ?? null;
}

export default async function handler(req) {
  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "s-maxage=300",
    "Access-Control-Allow-Origin": "*",
  };

  const raw = await kvGet("config:current_gp");
  if (!raw) {
    return new Response(JSON.stringify({ found: false }), { headers });
  }

  try {
    const gp = JSON.parse(raw);
    return new Response(JSON.stringify({ found: true, gp }), { headers });
  } catch {
    return new Response(JSON.stringify({ found: false }), { headers });
  }
}
