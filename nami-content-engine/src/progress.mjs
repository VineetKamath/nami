import { listJobs } from './jobs.mjs';
import { readFunding } from './funding.mjs';
import { spent, projectCeiling } from './budget.mjs';
import { mediaUrl } from './feed.mjs';

// Public "making of" view. Only armed video jobs, only display-safe fields: no prompts, errors, keys or addresses.
const WAITING_LABEL = {
  budget: 'Waiting for production budget',
  provider: 'Waiting for the render service to be connected',
  config: 'Waiting for start frames',
};

function steps(job) {
  const sb = job.draft?.storyboard;
  const shots = sb?.shots || [];
  const clipsDone = shots.filter((s) => job.stages[`clip-${s.n}`]?.status === 'done').length;
  const approved = (gate) => job.approvals.some((a) => a.gate === gate && !a.rejected);
  const st = (done, active) => (done ? 'done' : active ? 'active' : 'pending');
  const rendering = job.status === 'rendering';
  return [
    { key: 'storyboard', label: 'Storyboard approved', state: st(approved('storyboard'), false) },
    { key: 'pilot', label: 'Pilot clip', state: st(job.stages['clip-1']?.status === 'done', rendering && job.gate === 'storyboard') },
    { key: 'pilot-review', label: 'Pilot review', state: st(approved('pilot'), job.status === 'awaiting_approval' && job.gate === 'pilot') },
    { key: 'clips', label: `Shots ${clipsDone}/${shots.length}`, state: st(shots.length > 0 && clipsDone === shots.length, rendering && job.gate === 'pilot') },
    { key: 'finishing', label: 'Captions, graphics, export', state: st(job.stages.export?.status === 'done', false) },
    { key: 'final-review', label: 'Final review', state: st(approved('final'), job.status === 'awaiting_approval' && job.gate === 'final') },
    { key: 'published', label: 'Published', state: st(job.status === 'published', false) },
  ];
}

export function progressView(cfg) {
  const funding = readFunding(cfg);
  const jobs = listJobs(cfg).filter((j) => j.kind === 'video' && (j.autopilot || j.status === 'published') && j.options?.public !== false && j.approvals?.length);
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    budget: {
      fundingWatch: cfg.funding.enabled,
      receivedUsd: cfg.funding.enabled ? funding.receivedUsd : null,
      lastCheckedAt: cfg.funding.enabled ? funding.lastCheckedAt : null,
      video: { unlockedUsd: projectCeiling(cfg, 'video'), spentUsd: spent(cfg, { category: 'video' }) },
    },
    jobs: jobs.map((job) => {
      const s = steps(job);
      const shots = job.draft?.storyboard?.shots || [];
      return {
        id: job.id,
        title: job.draft?.storyboard?.title || 'Untitled',
        status: job.status,
        waiting: job.waiting ? WAITING_LABEL[job.waiting.kind] || 'Waiting' : null,
        steps: s,
        percent: Math.round((s.filter((x) => x.state === 'done').length / s.length) * 100),
        shots: shots.map((sh) => ({
          n: sh.n,
          seconds: sh.seconds,
          state: job.stages[`clip-${sh.n}`]?.status === 'done' ? 'done' : job.stages[`clip-${sh.n}`]?.status === 'running' ? 'rendering' : 'pending',
          preview: cfg.progress.showPreviews && job.stages[`clip-${sh.n}`]?.output?.file?.endsWith('.mp4') ? mediaUrl(cfg, job.id, job.stages[`clip-${sh.n}`].output.file) : null,
        })),
        updatedAt: job.updatedAt,
      };
    }),
  };
}
