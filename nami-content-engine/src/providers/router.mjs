import { withBudget, BudgetError } from '../budget.mjs';
import { paidCallsEnabled, publishingEnabled } from '../config.mjs';
import { templateLanguage, openaiLanguage } from './language.mjs';
import { placeholderImage, openaiImage } from './image.mjs';
import { placeholderVideo, higgsfieldVideo } from './video.mjs';
import { dryRunPublisher, xPublisher } from './x.mjs';

// Ordered by preference; free fallbacks last so routing degrades to $0 instead of failing.
export const REGISTRY = {
  language: [openaiLanguage, templateLanguage],
  image: [openaiImage, placeholderImage],
  video: [higgsfieldVideo, placeholderVideo],
  publisher: [xPublisher, dryRunPublisher],
};

const SPEND_STATES = { text: null, image: ['rendering'], video: ['rendering'] };

// Why a provider may not run for this job right now (null = allowed).
export function blockReason(cfg, job, p) {
  if (!p.available(cfg)) return 'not configured';
  if (p.paid) {
    if (!paidCallsEnabled(cfg)) return 'paid calls disabled (DRY_RUN / ALLOW_PAID_CALLS)';
    if (!job.spendApproved?.[p.category]) return `no ${p.category} spend approval on this job`;
    const states = SPEND_STATES[p.category];
    if (states && !states.includes(job.status)) return `paid ${p.category} only while rendering`;
  }
  if (p.outward) {
    if (!publishingEnabled(cfg)) return 'publishing disabled (DRY_RUN / X_PUBLISH_ENABLED)';
    if (job.status !== 'approved') return 'job not approved';
  }
  return null;
}

export async function callProvider(cfg, job, kind, req, { only } = {}) {
  const tried = [];
  for (const p of REGISTRY[kind]) {
    if (only && p.name !== only) continue;
    const reason = blockReason(cfg, job, p);
    if (reason) { tried.push(`${p.name}: ${reason}`); continue; }
    let estimateUsd;
    try {
      estimateUsd = p.estimate(req, cfg);
      const result = await withBudget(cfg, job, { category: p.category, provider: p.name, estimateUsd }, () => p.run(req, { cfg, job }));
      return { ...result, provider: p.name, paid: p.paid, estimateUsd, skipped: tried };
    } catch (err) {
      if (err instanceof BudgetError) { tried.push(`${p.name}: ${err.message}`); continue; }
      throw err;
    }
  }
  throw new Error(`No ${kind} provider could run: ${tried.join(' | ')}`);
}

export function providerStatus(cfg, job) {
  const fake = job || { status: 'approved', spendApproved: { text: true, image: true, video: true } };
  return Object.fromEntries(Object.entries(REGISTRY).map(([kind, list]) => [kind, list.map((p) => ({
    name: p.name, paid: p.paid, configured: p.available(cfg), blocked: blockReason(cfg, fake, p),
  }))]));
}
