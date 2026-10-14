import crypto from 'node:crypto';

const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

// OAuth 1.0a header (JSON bodies are not part of the signature base string).
export function oauthHeader({ method, url, consumerKey, consumerSecret, token, tokenSecret, nonce, timestamp }) {
  const params = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: nonce || crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(timestamp || Math.floor(Date.now() / 1000)),
    oauth_token: token,
    oauth_version: '1.0',
  };
  const u = new URL(url);
  const all = { ...params };
  for (const [k, v] of u.searchParams) all[k] = v;
  const paramStr = Object.keys(all).sort().map((k) => `${enc(k)}=${enc(all[k])}`).join('&');
  const base = [method.toUpperCase(), enc(`${u.origin}${u.pathname}`), enc(paramStr)].join('&');
  params.oauth_signature = crypto.createHmac('sha1', `${enc(consumerSecret)}&${enc(tokenSecret)}`).update(base).digest('base64');
  return 'OAuth ' + Object.keys(params).sort().map((k) => `${enc(k)}="${enc(params[k])}"`).join(', ');
}

export const dryRunPublisher = {
  name: 'x-dry-run',
  category: 'text',
  paid: false,
  outward: false,
  available: () => true,
  estimate: () => 0,
  async run(req) {
    const id = `dry-${Date.now()}`;
    return { id, url: null, text: req.text, dryRun: true, costUsd: 0 };
  },
};

export const xPublisher = {
  name: 'x-api',
  category: 'text',
  paid: false,
  outward: true, // posts publicly: needs X_PUBLISH_ENABLED and an approved job, enforced by the router
  available: (cfg) => Boolean(cfg.x.apiKey && cfg.x.apiSecret && cfg.x.accessToken && cfg.x.accessSecret),
  estimate: (_req, cfg) => cfg.x.estCostPerPost,
  async run(req, { cfg }) {
    const url = 'https://api.x.com/2/tweets';
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: oauthHeader({ method: 'POST', url, consumerKey: cfg.x.apiKey, consumerSecret: cfg.x.apiSecret, token: cfg.x.accessToken, tokenSecret: cfg.x.accessSecret }),
      },
      body: JSON.stringify({ text: req.text }),
    });
    if (!res.ok) throw new Error(`X ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const id = (await res.json()).data?.id;
    return { id, url: id ? `https://x.com/i/web/status/${id}` : null, text: req.text, dryRun: false, costUsd: cfg.x.estCostPerPost };
  },
};
