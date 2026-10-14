import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { readJson, writeJsonAtomic } from './store.mjs';
import { CATEGORIES } from './config.mjs';

export const STATES = ['planned', 'drafted', 'awaiting_approval', 'approved', 'rendering', 'rendered', 'published', 'failed'];

// rendered -> awaiting_approval exists for the video review gates (pilot, final).
// failed -> * exists so a job can be resumed from where it stopped.
export const TRANSITIONS = {
  planned: ['drafted', 'failed'],
  drafted: ['drafted', 'awaiting_approval', 'failed'],
  awaiting_approval: ['approved', 'drafted', 'failed'],
  approved: ['rendering', 'published', 'failed'],
  rendering: ['rendered', 'failed'],
  rendered: ['awaiting_approval', 'failed'],
  published: [],
  failed: ['planned', 'drafted', 'awaiting_approval', 'approved'],
};

export const KINDS = ['post', 'video'];

const jobsDir = (cfg) => path.join(cfg.dataDir, 'jobs');
export const jobDir = (cfg, id) => {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error(`Invalid job id: ${id}`);
  return path.join(jobsDir(cfg), id);
};
const jobFile = (cfg, id) => path.join(jobDir(cfg, id), 'job.json');

export function createJob(cfg, { kind = 'post', brief, budget = {}, options = {} }) {
  if (!KINDS.includes(kind)) throw new Error(`kind must be one of ${KINDS.join(', ')}`);
  if (!brief || typeof brief !== 'string') throw new Error('brief is required');
  const jobBudget = {};
  for (const c of CATEGORIES) {
    const requested = budget[c] === undefined ? cfg.jobBudget[c] : Number(budget[c]);
    if (!Number.isFinite(requested) || requested < 0) throw new Error(`Invalid ${c} budget`);
    jobBudget[c] = Math.min(requested, cfg.projectBudget[c]);
  }
  // Ordinary posts never get image/video money: the premium pipeline is opt-in per job.
  if (kind === 'post') { jobBudget.image = 0; jobBudget.video = 0; }

  const now = new Date().toISOString();
  const id = `${now.slice(0, 10)}-${kind}-${crypto.randomBytes(3).toString('hex')}`;
  const job = {
    id, kind, brief: brief.trim(), options,
    status: 'planned',
    gate: null,              // which approval the job is waiting for / was approved at
    budget: jobBudget,
    spendApproved: { text: false, image: false, video: false },
    draft: null,
    stages: {},              // resumable pipeline stages: { name: { status, output, at } }
    approvals: [],
    publication: null,
    error: null,
    resumeFrom: null,
    createdAt: now, updatedAt: now,
    history: [{ at: now, from: null, to: 'planned', note: 'created' }],
  };
  saveJob(cfg, job);
  return job;
}

export function saveJob(cfg, job) {
  job.updatedAt = new Date().toISOString();
  writeJsonAtomic(jobFile(cfg, job.id), job);
  return job;
}

export function loadJob(cfg, id) {
  const job = readJson(jobFile(cfg, id), null);
  if (!job) throw new Error(`Job not found: ${id}`);
  return job;
}

export function listJobs(cfg) {
  const dir = jobsDir(cfg);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((d) => fs.existsSync(path.join(dir, d, 'job.json')))
    .map((d) => loadJob(cfg, d))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function canTransition(from, to) {
  return (TRANSITIONS[from] || []).includes(to);
}

export function transition(cfg, job, to, note = '') {
  if (!STATES.includes(to)) throw new Error(`Unknown state ${to}`);
  if (!canTransition(job.status, to)) throw new Error(`Illegal transition ${job.status} -> ${to} for job ${job.id}`);
  const at = new Date().toISOString();
  if (to === 'failed') job.resumeFrom = job.status === 'rendering' ? 'approved' : job.status;
  job.history.push({ at, from: job.status, to, note });
  job.status = to;
  return saveJob(cfg, job);
}

export function fail(cfg, job, err) {
  job.error = { message: String(err?.message || err), at: new Date().toISOString() };
  if (job.status !== 'failed' && canTransition(job.status, 'failed')) return transition(cfg, job, 'failed', job.error.message);
  return saveJob(cfg, job);
}

export function resume(cfg, job) {
  if (job.status !== 'failed') throw new Error(`Job ${job.id} is ${job.status}, not failed`);
  const to = job.resumeFrom || 'planned';
  job.error = null;
  return transition(cfg, job, to, 'resumed');
}

// Resumable stage helper: skip stages already done, persist each result.
export async function runStage(cfg, job, name, fn) {
  const prev = job.stages[name];
  if (prev?.status === 'done') return prev.output;
  job.stages[name] = { ...prev, status: 'running', at: new Date().toISOString() }; // keeps prev.pending (vendor request id)
  saveJob(cfg, job);
  const output = await fn();
  job.stages[name] = { status: 'done', output, at: new Date().toISOString() };
  saveJob(cfg, job);
  return output;
}
