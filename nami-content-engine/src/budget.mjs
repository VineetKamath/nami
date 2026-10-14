import path from 'node:path';
import { appendJsonl, readJsonl } from './store.mjs';
import { CATEGORIES } from './config.mjs';

// Ledger is append-only JSONL. Each entry carries a signed USD amount:
// reserve (+estimate) -> settle (actual - estimate) | release (-estimate).
const ledgerFile = (cfg) => path.join(cfg.dataDir, 'ledger.jsonl');

export class BudgetError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'BudgetError';
    this.details = details;
  }
}

const round = (n) => Math.round(n * 1e6) / 1e6;

export function spent(cfg, { jobId, category } = {}) {
  return round(readJsonl(ledgerFile(cfg))
    .filter((e) => (!jobId || e.jobId === jobId) && (!category || e.category === category))
    .reduce((sum, e) => sum + e.amountUsd, 0));
}

export function budgetReport(cfg, job) {
  const rows = {};
  for (const c of CATEGORIES) {
    rows[c] = {
      projectSpent: spent(cfg, { category: c }),
      projectCeiling: cfg.projectBudget[c],
      ...(job ? { jobSpent: spent(cfg, { jobId: job.id, category: c }), jobCeiling: job.budget[c] } : {}),
    };
  }
  return rows;
}

// Throws BudgetError if the estimate would push the job or project over its ceiling.
export function checkBudget(cfg, job, category, estimateUsd) {
  if (!CATEGORIES.includes(category)) throw new BudgetError(`Unknown budget category ${category}`);
  if (!Number.isFinite(estimateUsd) || estimateUsd < 0) throw new BudgetError(`Invalid cost estimate ${estimateUsd}`);
  const jobSpent = spent(cfg, { jobId: job.id, category });
  const projectSpent = spent(cfg, { category });
  const jobCeiling = Math.min(job.budget[category] ?? 0, cfg.projectBudget[category]);
  const details = { category, estimateUsd, jobSpent, jobCeiling, projectSpent, projectCeiling: cfg.projectBudget[category] };
  if (round(jobSpent + estimateUsd) > jobCeiling) {
    throw new BudgetError(`${category} call ($${estimateUsd}) exceeds job ceiling: spent $${jobSpent} of $${jobCeiling}`, details);
  }
  if (round(projectSpent + estimateUsd) > cfg.projectBudget[category]) {
    throw new BudgetError(`${category} call ($${estimateUsd}) exceeds project ceiling: spent $${projectSpent} of $${cfg.projectBudget[category]}`, details);
  }
  return details;
}

// Every provider call goes through here. Reserve before, settle or release after.
export async function withBudget(cfg, job, { category, provider, estimateUsd }, fn) {
  checkBudget(cfg, job, category, estimateUsd);
  const base = { jobId: job.id, category, provider };
  const file = ledgerFile(cfg);
  appendJsonl(file, { ...base, at: new Date().toISOString(), type: 'reserve', amountUsd: estimateUsd });
  let result;
  try {
    result = await fn();
  } catch (err) {
    appendJsonl(file, { ...base, at: new Date().toISOString(), type: 'release', amountUsd: -estimateUsd });
    throw err;
  }
  const actual = Number.isFinite(result?.costUsd) ? result.costUsd : estimateUsd;
  appendJsonl(file, { ...base, at: new Date().toISOString(), type: 'settle', amountUsd: round(actual - estimateUsd) });
  return result;
}

export const ledger = (cfg) => readJsonl(ledgerFile(cfg));
