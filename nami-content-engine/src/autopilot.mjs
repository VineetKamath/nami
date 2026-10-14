import { listJobs, loadJob, saveJob } from './jobs.mjs';
import { pollFunding } from './funding.mjs';
import * as engine from './engine.mjs';

// One pass: refresh funding, then push every armed job forward until it needs a human or money.
// Human gates kept: storyboard approval (before arming) and final approval (before publishing).
// The pilot gate is human too unless AUTOPILOT_REQUIRE_PILOT_APPROVAL=false.
export async function tick(cfg, log = console.log) {
  if (cfg.funding.enabled) {
    try {
      const f = await pollFunding(cfg);
      log(`funding: $${f.receivedUsd} received in total`);
    } catch (err) {
      log(`funding poll failed: ${err.message}`);
    }
  }

  for (const { id } of listJobs(cfg).filter((j) => j.autopilot && j.status !== 'published')) {
    try {
      let job = loadJob(cfg, id);
      if (job.status === 'failed') {
        job.autopilotRetries = (job.autopilotRetries || 0) + 1;
        if (job.autopilotRetries > cfg.autopilot.maxRetries) {
          if (job.autopilot) { job.autopilot = false; saveJob(cfg, job); log(`${id}: disarmed after ${cfg.autopilot.maxRetries} failed retries: ${job.error?.message}`); }
          continue;
        }
        saveJob(cfg, job);
        job = engine.resume(cfg, id);
      }
      if (job.status === 'awaiting_approval' && job.gate === 'pilot' && !cfg.autopilot.requirePilotApproval) {
        job = engine.approve(cfg, id, { by: 'autopilot', note: 'pilot auto-approved (AUTOPILOT_REQUIRE_PILOT_APPROVAL=false)' });
      }
      if (job.status === 'approved' && ['storyboard', 'pilot'].includes(job.gate)) {
        job = await engine.render(cfg, id);
        if (job.waiting) log(`${id}: waiting (${job.waiting.kind}): ${job.waiting.reason}`);
        else log(`${id}: ${job.status} at gate ${job.gate}`);
        if (job.status === 'awaiting_approval') { job.autopilotRetries = 0; saveJob(cfg, job); }
      }
    } catch (err) {
      log(`${id}: ${err.message}`);
    }
  }
}

export function startAutopilot(cfg, log = console.log) {
  let running = false;
  const run = async () => {
    if (running) return; // never overlap passes (renders can take minutes)
    running = true;
    try { await tick(cfg, log); } finally { running = false; }
  };
  run();
  return setInterval(run, cfg.autopilot.intervalSeconds * 1000);
}
