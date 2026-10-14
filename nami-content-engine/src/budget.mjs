import path from 'node:path';
import { appendJsonl, readJsonl } from './store.mjs';
import { CATEGORIES } from './config.mjs';
import { fundedAllocation } from './funding.mjs';

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

// Static project ceiling, further limited by fees actually received when the funding gate is on.
export function projectCeiling(cfg, category) {
  const funded = fundedAllocation(cfg, category);
  return funded === null ? cfg.projectBudget[category] : Math.min(cfg.projectBudget[category], funded);
}

export function budgetReport(cfg, job) {
  const rows = {};
  for (const c of CATEGORIES) {
    rows[c] = {
      projectSpent: spent(cfg, { category: c }),
      projectCeiling: projectCeiling(cfg, c),
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
  const projCeil = projectCeiling(cfg, category);
  const jobCeiling = Math.min(job.budget[category] ?? 0, cfg.projectBudget[category]);
  const details = { category, estimateUsd, jobSpent, jobCeiling, projectSpent, projectCeiling: projCeil };
  if (round(jobSpent + estimateUsd) > jobCeiling) {
    throw new BudgetError(`${category} call ($${estimateUsd}) exceeds job ceiling: spent $${jobSpent} of $${jobCeiling}`, details);
  }
  if (round(projectSpent + estimateUsd) > projCeil) {
    throw new BudgetError(`${category} call ($${estimateUsd}) exceeds project ceiling: spent $${projectSpent} of $${projCeil}`, details);
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
    // err.charged: the vendor accepted the job before it failed, so keep the reservation as spent.
    if (err.charged) appendJsonl(file, { ...base, at: new Date().toISOString(), type: 'settle', amountUsd: 0, note: err.message });
    else appendJsonl(file, { ...base, at: new Date().toISOString(), type: 'release', amountUsd: -estimateUsd });
    throw err;
  }
  const actual = Number.isFinite(result?.costUsd) ? result.costUsd : estimateUsd;
  appendJsonl(file, { ...base, at: new Date().toISOString(), type: 'settle', amountUsd: round(actual - estimateUsd) });
  return result;
}

export const ledger = (cfg) => readJsonl(ledgerFile(cfg));
