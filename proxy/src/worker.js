// CORS proxy for Yahoo Finance quotes (used by invest-monitor's live prices).
// Yahoo serves the data we need but sends no CORS headers, so the browser can't
// call it directly. This Worker fetches the requested Yahoo URL server-side and
// re-serves it with `Access-Control-Allow-Origin`, so the SPA can read it.
//
// Locked to Yahoo finance hosts so it can't be abused as an open proxy.
// Usage: GET https://<worker>.workers.dev/?url=<url-encoded Yahoo URL>

const ALLOWED_HOSTS = new Set(['query1.finance.yahoo.com', 'query2.finance.yahoo.com'])

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': '*',
}

export default {
  async fetch(req) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
    if (req.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: CORS })

    const target = new URL(req.url).searchParams.get('url')
    if (!target) return new Response('Missing ?url=', { status: 400, headers: CORS })

    let parsed
    try {
      parsed = new URL(target)
    } catch {
      return new Response('Bad url', { status: 400, headers: CORS })
    }
    if (parsed.protocol !== 'https:' || !ALLOWED_HOSTS.has(parsed.hostname)) {
      return new Response('Host not allowed', { status: 403, headers: CORS })
    }

    const upstream = await fetch(parsed.toString(), {
      headers: { 'user-agent': 'Mozilla/5.0', accept: 'application/json' },
      cf: { cacheTtl: 60, cacheEverything: true }, // edge-cache 60s to ease upstream load
    })

    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        ...CORS,
        'content-type': upstream.headers.get('content-type') || 'application/json',
        'cache-control': 'public, max-age=60',
      },
    })
  },
}
