export const config = { runtime: 'edge' };

export default async function handler(req) {
  const headers = {
    'Content-Type': 'application/json',
  };

  try {
    // 1. récupérer toutes les clés profile
    const res = await fetch(`${process.env.KV_REST_API_URL}/keys/profile:*`, {
      headers: {
        Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
      },
    });

    const data = await res.json();
    const keys = data.result || [];

    // 2. récupérer chaque profil
    const profiles = await Promise.all(
      keys.map(async (key) => {
        const r = await fetch(`${process.env.KV_REST_API_URL}/get/${encodeURIComponent(key)}`, {
          headers: {
            Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
          },
        });

        const d = await r.json();
        try {
          return JSON.parse(d.result);
        } catch {
          return null;
        }
      })
    );

    // 3. filtrer emails
    const emails = profiles
      .filter(Boolean)
      .map(p => ({
        email: p.email,
        name: `${p.fn} ${p.ln}`,
        handle: p.handle,
        plan: p.plan,
        createdAt: p.createdAt,
      }));

    return new Response(JSON.stringify(emails), { status: 200, headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
}
