import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { loadConfig } from './config.mjs';
import { listJobs, loadJob, jobDir } from './jobs.mjs';
import { readFeed } from './feed.mjs';
import { budgetReport } from './budget.mjs';
import { providerStatus } from './providers/router.mjs';
import * as engine from './engine.mjs';
import { progressView } from './progress.mjs';
import { startAutopilot } from './autopilot.mjs';

const SITE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'site');

const MIME = { '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp4': 'video/mp4', '.json': 'application/json', '.srt': 'text/plain; charset=utf-8',
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.webp': 'image/webp', '.jpeg': 'image/jpeg', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon' };

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(body, null, 2));
}

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 64 * 1024) throw Object.assign(new Error('Body too large'), { status: 413 });
  }
  return raw ? JSON.parse(raw) : {};
}

function isAdmin(cfg, req) {
  const token = cfg.server.adminToken;
  const given = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token || !given) return false;
  const a = Buffer.from(token), b = Buffer.from(given);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const ACTIONS = {
  draft: (cfg, id) => engine.draft(cfg, id),
  submit: (cfg, id) => engine.submit(cfg, id),
  edit: (cfg, id, body) => engine.editDraft(cfg, id, String(body.text || '')),
  approve: (cfg, id, body) => engine.approve(cfg, id, body),
  reject: (cfg, id, body) => engine.reject(cfg, id, body),
  'approve-spend': (cfg, id, body) => engine.approveSpend(cfg, id, body.category, body),
  render: (cfg, id) => engine.render(cfg, id),
  publish: (cfg, id) => engine.publish(cfg, id),
  resume: (cfg, id) => engine.resume(cfg, id),
  next: (cfg, id) => engine.next(cfg, id),
  arm: (cfg, id) => engine.arm(cfg, id),
  disarm: (cfg, id) => engine.disarm(cfg, id),
};

export function createServer(cfg = loadConfig()) {
  return http.createServer(async (req, res) => {
    const cors = { 'access-control-allow-origin': cfg.server.corsOrigin };
    try {
      const url = new URL(req.url, 'http://local');
      const parts = url.pathname.split('/').filter(Boolean);

      if (req.method === 'OPTIONS') return send(res, 204, {}, { ...cors, 'access-control-allow-methods': 'GET', 'access-control-allow-headers': 'content-type' });

      // ---- Public, read-only ----
      if (req.method === 'GET' && url.pathname === '/api/health') return send(res, 200, { ok: true, dryRun: cfg.dryRun }, cors);
      if (req.method === 'GET' && url.pathname === '/api/progress') return send(res, 200, progressView(cfg), cors);
      // Static website (site/): / -> index.html, /progress -> progress.html, /assets/*
      if (req.method === 'GET' && parts[0] !== 'api' && parts[0] !== 'media') {
        const rel = url.pathname === '/' ? 'index.html' : url.pathname === '/progress' ? 'progress.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
        const file = path.resolve(SITE_DIR, rel);
        if (file.startsWith(SITE_DIR + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) {
          res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
          return fs.createReadStream(file).pipe(res);
        }
      }
      if (req.method === 'GET' && url.pathname === '/api/feed') {
        const feed = readFeed(cfg);
        const includeDry = url.searchParams.get('includeDryRun') === '1';
        return send(res, 200, { ...feed, items: feed.items.filter((i) => includeDry || !i.dryRun) }, cors);
      }
      if (req.method === 'GET' && parts[0] === 'media' && parts.length === 3) {
        const job = loadJob(cfg, parts[1]);
        const preview = cfg.progress.showPreviews && job.autopilot && /^clip-\d+\.mp4$/.test(path.basename(decodeURIComponent(parts[2])));
        if (job.status !== 'published' && !preview) return send(res, 404, { error: 'not found' }, cors);
        const dir = path.join(jobDir(cfg, job.id), 'files');
        const file = path.join(dir, path.basename(decodeURIComponent(parts[2])));
        if (!file.startsWith(dir + path.sep) || !fs.existsSync(file)) return send(res, 404, { error: 'not found' }, cors);
        res.writeHead(200, { ...cors, 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
        return fs.createReadStream(file).pipe(res);
      }

      // ---- Admin ----
      if (parts[0] === 'api' && ['jobs', 'status', 'budget'].includes(parts[1])) {
        if (!isAdmin(cfg, req)) return send(res, 401, { error: 'admin token required (set ADMIN_TOKEN, send Authorization: Bearer <token>)' });
        if (req.method === 'GET' && parts[1] === 'status') {
          return send(res, 200, { dryRun: cfg.dryRun, allowPaidCalls: cfg.allowPaidCalls, publishEnabled: cfg.x.publishEnabled, feeWallet: cfg.feeWallet.solanaAddress || null, providers: providerStatus(cfg), warnings: cfg.warnings });
        }
        if (req.method === 'GET' && parts[1] === 'budget') return send(res, 200, budgetReport(cfg));
        if (req.method === 'GET' && parts.length === 2) return send(res, 200, listJobs(cfg));
        if (req.method === 'GET' && parts.length === 3) { const job = loadJob(cfg, parts[2]); return send(res, 200, { job, budget: budgetReport(cfg, job) }); }
        if (req.method === 'POST' && parts.length === 2) return send(res, 201, engine.newJob(cfg, await readBody(req)));
        if (req.method === 'POST' && parts.length === 4 && ACTIONS[parts[3]]) return send(res, 200, await ACTIONS[parts[3]](cfg, parts[2], await readBody(req)));
      }
      return send(res, 404, { error: 'not found' }, cors);
    } catch (err) {
      const status = err.status || (/not found/i.test(err.message) ? 404 : 400);
      return send(res, status, { error: err.message, ...(err.details ? { details: err.details } : {}), ...(err.issues ? { issues: err.issues } : {}) }, cors);
    }
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const cfg = loadConfig();
  for (const w of cfg.warnings) console.warn(`WARNING: ${w}`);
  if (!cfg.server.adminToken) console.warn('WARNING: ADMIN_TOKEN not set; admin endpoints are disabled (use the CLI instead).');
  createServer(cfg).listen(cfg.server.port, cfg.server.host, () => {
    console.log(`nami-content-engine on http://${cfg.server.host}:${cfg.server.port}  (dryRun=${cfg.dryRun}, paid=${cfg.allowPaidCalls}, publish=${cfg.x.publishEnabled}, funding=${cfg.funding.enabled}, autopilot=${cfg.autopilot.enabled})`);
    if (cfg.autopilot.enabled) startAutopilot(cfg, (m) => console.log(`[autopilot] ${m}`));
  });
}
