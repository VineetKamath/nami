import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.mjs';
import { createJob, transition, loadJob } from '../src/jobs.mjs';
import { checkBudget, spent, BudgetError } from '../src/budget.mjs';
import { checkContent } from '../src/safety.mjs';
import { oauthHeader } from '../src/providers/x.mjs';
import { readFeed } from '../src/feed.mjs';
import { createServer } from '../src/server.mjs';
import * as engine from '../src/engine.mjs';

let dir;
const realFetch = globalThis.fetch;
const cfgWith = (env = {}) => loadConfig({ envFile: '/nonexistent', env: { DATA_DIR: dir, DRY_RUN: 'true', ALLOW_PAID_CALLS: 'false', X_PUBLISH_ENABLED: 'false', ...env } });

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nami-'));
  globalThis.fetch = async () => { throw new Error('network call attempted in test'); };
});
afterEach(() => { globalThis.fetch = realFetch; fs.rmSync(dir, { recursive: true, force: true }); });

test('defaults are safe: dry run, no paid calls, $0 text, $5 image, $75 video', () => {
  const cfg = cfgWith();
  assert.equal(cfg.dryRun, true);
  assert.equal(cfg.allowPaidCalls, false);
  assert.deepEqual(cfg.jobBudget, { text: 0, image: 5, video: 75 });
});

test('fee wallet accepts only a public address and rejects private keys', () => {
  assert.equal(cfgWith({ SOLANA_FEE_WALLET_ADDRESS: '11111111111111111111111111111111' }).feeWallet.solanaAddress, '11111111111111111111111111111111');
  assert.throws(() => cfgWith({ SOLANA_FEE_WALLET_ADDRESS: '5'.repeat(88) }), /public Solana address/);
  assert.match(cfgWith({ SOLANA_PRIVATE_KEY: 'x' }).warnings.join(), /never read/);
});

test('state machine rejects illegal transitions', () => {
  const cfg = cfgWith();
  const job = createJob(cfg, { kind: 'post', brief: 'hello' });
  assert.throws(() => transition(cfg, job, 'published'), /Illegal transition/);
  assert.throws(() => transition(cfg, job, 'approved'), /Illegal transition/);
});

test('posts never get image or video budget', () => {
  const job = createJob(cfgWith(), { kind: 'post', brief: 'x', budget: { video: 50, image: 5 } });
  assert.equal(job.budget.video, 0);
  assert.equal(job.budget.image, 0);
  return assert.rejects(engine.render(cfgWith(), job.id), /Only video jobs render/);
});

test('budget gate blocks calls over job and project ceilings', () => {
  const cfg = cfgWith();
  const job = createJob(cfg, { kind: 'video', brief: 'x', budget: { video: 10 } });
  assert.throws(() => checkBudget(cfg, job, 'text', 0.01), BudgetError);
  assert.throws(() => checkBudget(cfg, job, 'video', 10.01), /job ceiling/);
  checkBudget(cfg, job, 'video', 10);
  const job2 = createJob(cfg, { kind: 'video', brief: 'x', budget: { video: 500 } });
  assert.equal(job2.budget.video, 75, 'job budget is capped at the project ceiling');
});

test('paid text provider is skipped at $0 text budget even with everything enabled', async () => {
  const cfg = cfgWith({ DRY_RUN: 'false', ALLOW_PAID_CALLS: 'true', OPENAI_API_KEY: 'sk-test' });
  const job = createJob(cfg, { kind: 'post', brief: 'rain on the window' });
  engine.approveSpend(cfg, job.id, 'text');
  const drafted = await engine.draft(cfg, job.id); // fetch would throw if OpenAI were called
  assert.equal(drafted.draft.provider, 'template');
});

test('paid image call runs only with approval + switches, and is recorded in the ledger', async () => {
  const cfg = cfgWith({ DRY_RUN: 'false', ALLOW_PAID_CALLS: 'true', OPENAI_API_KEY: 'sk-test', OPENAI_EST_COST_PER_IMAGE_USD: '0.07' });
  let calls = 0;
  globalThis.fetch = async (url) => {
    assert.match(String(url), /images\/generations/);
    calls++;
    return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('png').toString('base64') }] }));
  };
  const job = createJob(cfg, { kind: 'video', brief: 'studio at night', options: { shots: 2 } });
  await engine.draft(cfg, job.id);
  await engine.render(cfg, job.id).catch(() => {}); // not approved yet
  assert.equal(calls, 0);
  engine.approve(cfg, job.id);
  const after = await engine.render(cfg, job.id);
  assert.equal(calls, 2);
  assert.equal(after.gate, 'pilot');
  assert.equal(spent(cfg, { jobId: job.id, category: 'image' }), 0.14);
  assert.equal(after.stages['clip-1'].output.provider, 'placeholder-video');
});

test('video pipeline: storyboard -> pilot -> final -> publish (dry run) with resumable stages', async () => {
  const cfg = cfgWith();
  const job = createJob(cfg, { kind: 'video', brief: 'nami closes the studio', options: { shots: 3 } });
  const seq = [['next', 'awaiting_approval', 'storyboard'], ['approve', 'approved'], ['next', 'awaiting_approval', 'pilot'], ['approve', 'approved'], ['next', 'awaiting_approval', 'final'], ['approve', 'approved'], ['next', 'published']];
  for (const [action, status, gate] of seq) {
    const j = action === 'approve' ? engine.approve(cfg, job.id) : await engine.next(cfg, job.id);
    assert.equal(j.status, status);
    if (gate) assert.equal(j.gate, gate);
  }
  const item = readFeed(cfg).items[0];
  assert.equal(item.id, job.id);
  assert.equal(item.dryRun, true);
  assert.equal(item.media[0].role, 'poster');
});

test('failed render resumes without redoing finished stages', async () => {
  const cfg = cfgWith();
  const job = createJob(cfg, { kind: 'video', brief: 'quiet hour', options: { shots: 2 } });
  await engine.draft(cfg, job.id);
  engine.approve(cfg, job.id);
  const j = loadJob(cfg, job.id);
  j.draft.storyboard.shots[1].action = undefined; // corrupt shot 2 so plate-2 succeeds but render later fails
  fs.writeFileSync(path.join(dir, 'jobs', job.id, 'job.json'), JSON.stringify({ ...j, draft: { ...j.draft, storyboard: { ...j.draft.storyboard, shots: [j.draft.storyboard.shots[0], null] } } }));
  await assert.rejects(engine.render(cfg, job.id));
  assert.equal(loadJob(cfg, job.id).status, 'failed');
  const plateAt = loadJob(cfg, job.id).stages['plate-1'].at;
  const fixed = loadJob(cfg, job.id);
  fixed.draft.storyboard.shots = j.draft.storyboard.shots.map((s) => ({ ...s, action: s.action || 'smiles' }));
  fs.writeFileSync(path.join(dir, 'jobs', job.id, 'job.json'), JSON.stringify(fixed));
  assert.equal(engine.resume(cfg, job.id).status, 'approved');
  const done = await engine.render(cfg, job.id);
  assert.equal(done.gate, 'pilot');
  assert.equal(done.stages['plate-1'].at, plateAt, 'plate-1 was not regenerated');
});

test('safety policy blocks financial content and sentience claims, allows normal posts', () => {
  for (const bad of ['buy $NAMI now', 'this token will 100x', 'guaranteed returns', 'i am sentient', 'send SOL to my wallet', 'nami is an AGI']) {
    assert.equal(checkContent(bad).ok, false, bad);
  }
  for (const ok of ['rain on the studio window. what are you listening to?', 'hidden gem of a city pop record 📼', 'long night, short playlist']) {
    assert.equal(checkContent(ok).ok, true, ok);
  }
});

test('unsafe edits cannot be approved or published', () => {
  const cfg = cfgWith();
  const job = createJob(cfg, { kind: 'post', brief: 'x' });
  transition(cfg, job, 'drafted');
  engine.editDraft(cfg, job.id, 'buy the token now');
  assert.throws(() => engine.submit(cfg, job.id), /Safety policy/);
});

test('OAuth 1.0a signature matches the X documentation example', () => {
  // Example from developer.x.com "Creating a signature" (POST statuses/update).
  const h = oauthHeader({
    method: 'POST',
    url: 'https://api.twitter.com/1.1/statuses/update.json?include_entities=true&status=' + encodeURIComponent('Hello Ladies + Gentlemen, a signed OAuth request!').replace(/!/g, '%21'),
    consumerKey: 'xvz1evFS4wEEPTGEFPHBog', consumerSecret: 'kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw',
    token: '370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb', tokenSecret: 'LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE',
    nonce: 'kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg', timestamp: 1318622958,
  });
  assert.match(h, /oauth_signature="hCtSmYh%2BiHYCEqBWrE7C7hYmtUk%3D"/);
});

test('server: feed is public, hides dry runs by default; admin endpoints need token', async () => {
  const cfg = cfgWith({ ADMIN_TOKEN: 'secret-token' });
  const job = createJob(cfg, { kind: 'post', brief: 'late shift' });
  await engine.next(cfg, job.id); engine.approve(cfg, job.id); await engine.next(cfg, job.id);
  const srv = createServer(cfg).listen(0);
  const base = `http://127.0.0.1:${srv.address().port}`;
  globalThis.fetch = realFetch;
  try {
    assert.equal((await (await fetch(`${base}/api/feed`)).json()).items.length, 0);
    assert.equal((await (await fetch(`${base}/api/feed?includeDryRun=1`)).json()).items.length, 1);
    assert.equal((await fetch(`${base}/api/jobs`)).status, 401);
    const r = await fetch(`${base}/api/jobs`, { method: 'POST', headers: { authorization: 'Bearer secret-token' }, body: JSON.stringify({ kind: 'post', brief: 'hi' }) });
    assert.equal(r.status, 201);
  } finally { srv.close(); }
});
