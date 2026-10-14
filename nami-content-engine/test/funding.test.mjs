import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, ROOT } from '../src/config.mjs';
import { createJob, loadJob } from '../src/jobs.mjs';
import { pollFunding } from '../src/funding.mjs';
import { projectCeiling, spent } from '../src/budget.mjs';
import { progressView } from '../src/progress.mjs';
import { tick } from '../src/autopilot.mjs';
import * as engine from '../src/engine.mjs';

const WALLET = '11111111111111111111111111111111';
const storyboard = JSON.parse(fs.readFileSync(path.join(ROOT, 'prompts/storyboards/signal.json'), 'utf8'));
let dir, lamports, hf;
const realFetch = globalThis.fetch;

// Fake Solana RPC, price feed and Higgsfield API. Anything else is a test failure.
function fakeNetwork() {
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const json = (body) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
    if (u.startsWith('https://rpc.test')) return json({ jsonrpc: '2.0', id: 1, result: { value: lamports } });
    if (u.includes('coingecko')) return json({ solana: { usd: 100 } });
    if (u === 'https://hf.test/model/i2v' && init.method === 'POST') {
      hf.submits.push(JSON.parse(init.body));
      return json({ request_id: `r${hf.submits.length}`, status_url: `https://hf.test/requests/r${hf.submits.length}/status` });
    }
    if (u.startsWith('https://hf.test/requests/')) {
      hf.polls++;
      return json({ status: 'completed', video: { url: `https://cdn.test/${u.split('/')[4]}.mp4` } });
    }
    if (u.startsWith('https://cdn.test/')) return new Response(Buffer.from('mp4data'));
    throw new Error(`unexpected network call: ${u}`);
  };
}

const cfgWith = (env = {}) => loadConfig({ envFile: '/nonexistent', env: {
  DATA_DIR: dir, DRY_RUN: 'false', ALLOW_PAID_CALLS: 'true', X_PUBLISH_ENABLED: 'false',
  SOLANA_FEE_WALLET_ADDRESS: WALLET, FUNDING_WATCH_ENABLED: 'true', SOLANA_RPC_URL: 'https://rpc.test',
  FUNDING_VIDEO_PCT: '80', FUNDING_IMAGE_PCT: '10',
  HIGGSFIELD_API_KEY: 'k', HIGGSFIELD_API_SECRET: 's', HIGGSFIELD_BASE_URL: 'https://hf.test', HIGGSFIELD_VIDEO_MODEL: 'model/i2v',
  HIGGSFIELD_POLL_SECONDS: '0', VIDEO_EST_COST_PER_SECOND_USD: '1',
  NAMI_REFERENCE_IMAGE_URL: 'https://img.test/nami.png', ...env,
} });

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nami-fund-'));
  lamports = 0;
  hf = { submits: [], polls: 0 };
  fakeNetwork();
});
afterEach(() => { globalThis.fetch = realFetch; fs.rmSync(dir, { recursive: true, force: true }); });

function armedSignalJob(cfg) {
  const job = createJob(cfg, { kind: 'video', brief: 'signal', options: { quality: 'premium', storyboard } });
  return engine.draft(cfg, job.id).then(() => { engine.approve(cfg, job.id); return engine.arm(cfg, job.id); });
}

test('funding watcher values new SOL in USD and unlocks only the configured share', async () => {
  const cfg = cfgWith();
  assert.equal(projectCeiling(cfg, 'video'), 0, 'nothing unlocked before fees arrive');
  lamports = 0.5e9; // 0.5 SOL @ $100
  await pollFunding(cfg);
  assert.equal(projectCeiling(cfg, 'video'), 40);
  lamports = 0.2e9; // a withdrawal does not reduce what was received
  await pollFunding(cfg);
  lamports = 0.3e9; // +0.1 SOL
  const f = await pollFunding(cfg);
  assert.equal(f.receivedUsd, 60);
  assert.equal(projectCeiling(cfg, 'video'), 48);
  assert.equal(projectCeiling(cfg, 'text'), 0);
});

test('static ceiling still caps funding', async () => {
  const cfg = cfgWith({ PROJECT_BUDGET_VIDEO_USD: '20', JOB_BUDGET_VIDEO_USD: '20' });
  lamports = 10e9; // $1000 received
  await pollFunding(cfg);
  assert.equal(projectCeiling(cfg, 'video'), 20);
});

test('arming requires a storyboard approval', async () => {
  const cfg = cfgWith();
  const job = createJob(cfg, { kind: 'video', brief: 'signal', options: { quality: 'premium', storyboard } });
  await engine.draft(cfg, job.id);
  assert.throws(() => engine.arm(cfg, job.id), /Approve the storyboard first/);
});

test('armed job waits with no spend until fees arrive, then renders the pilot on Higgsfield', async () => {
  const cfg = cfgWith();
  const job = await armedSignalJob(cfg);

  await tick(cfg, () => {});
  let j = loadJob(cfg, job.id);
  assert.equal(j.status, 'approved');
  assert.equal(j.waiting.kind, 'budget');
  assert.equal(hf.submits.length, 0);
  assert.equal(progressView(cfg).jobs[0].waiting, 'Waiting for production budget');

  lamports = 0.1e9; // $10 -> $8 video unlocked; pilot shot is 5 s @ $1/s
  await tick(cfg, () => {});
  j = loadJob(cfg, job.id);
  assert.equal(j.status, 'awaiting_approval');
  assert.equal(j.gate, 'pilot');
  assert.equal(hf.submits.length, 1);
  assert.equal(hf.submits[0].image_url, 'https://img.test/nami.png');
  assert.equal(hf.submits[0].aspect_ratio, '9:16');
  assert.match(hf.submits[0].prompt, /opens her eyes/);
  assert.equal(spent(cfg, { category: 'video' }), 5);
  assert.ok(fs.existsSync(path.join(dir, 'jobs', job.id, 'files', 'clip-1.mp4')));

  // Pilot gate stays human by default.
  await tick(cfg, () => {});
  assert.equal(hf.submits.length, 1);
  assert.equal(loadJob(cfg, job.id).status, 'awaiting_approval');
});

test('after pilot approval the rest renders only when the remaining budget is funded', async () => {
  const cfg = cfgWith({ AUTOPILOT_REQUIRE_PILOT_APPROVAL: 'false' });
  const job = await armedSignalJob(cfg);
  lamports = 0.1e9; // $8 video: enough for the pilot only
  await tick(cfg, () => {}); // pilot
  await tick(cfg, () => {}); // auto-approve pilot, but 11 more shots ($54) are not funded
  let j = loadJob(cfg, job.id);
  assert.equal(j.gate, 'pilot');
  assert.equal(j.waiting.kind, 'budget');
  assert.equal(hf.submits.length, 1);

  lamports = 1e9; // +0.9 SOL -> $100 received, $75 static cap
  await tick(cfg, () => {});
  j = loadJob(cfg, job.id);
  assert.equal(j.status, 'awaiting_approval');
  assert.equal(j.gate, 'final', 'final review is always human');
  assert.equal(hf.submits.length, 12, 'pilot clip was reused, not re-rendered');
  assert.equal(spent(cfg, { category: 'video' }), 59);
});

test('a crash mid-render resumes by polling the same Higgsfield request, never paying twice', async () => {
  const cfg = cfgWith();
  const job = await armedSignalJob(cfg);
  lamports = 0.1e9;
  const okFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith('https://hf.test/requests/')) throw new Error('network down');
    return okFetch(url, init);
  };
  await tick(cfg, () => {});
  let j = loadJob(cfg, job.id);
  assert.equal(j.status, 'failed');
  assert.equal(j.stages['clip-1'].pending.requestId, 'r1');
  assert.equal(spent(cfg, { category: 'video' }), 5, 'submitted work counts as spent');

  globalThis.fetch = okFetch;
  await tick(cfg, () => {});
  j = loadJob(cfg, job.id);
  assert.equal(j.gate, 'pilot');
  assert.equal(hf.submits.length, 1, 'no second submit');
  assert.equal(spent(cfg, { category: 'video' }), 5);
});

test('public progress view exposes no prompts, errors, keys or wallet address', async () => {
  const cfg = cfgWith();
  await armedSignalJob(cfg);
  await tick(cfg, () => {});
  const text = JSON.stringify(progressView(cfg));
  for (const secret of [WALLET, 'opens her eyes', 'hf.test', 'img.test', 'exceeds']) assert.ok(!text.includes(secret), secret);
  assert.equal(progressView(cfg).jobs[0].shots.length, 12);
});
