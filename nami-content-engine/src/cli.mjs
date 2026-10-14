#!/usr/bin/env node
import { loadConfig } from './config.mjs';
import { listJobs, loadJob } from './jobs.mjs';
import { budgetReport, ledger } from './budget.mjs';
import { readFeed } from './feed.mjs';
import { checkContent } from './safety.mjs';
import { providerStatus } from './providers/router.mjs';
import * as engine from './engine.mjs';

const HELP = `nami-content-engine CLI

  new post "<brief>"                     create a text post job
  new video "<brief>" [--shots 3] [--seconds 12] [--video-budget 20] [--image-budget 2]
  list                                   list jobs
  show <id>                              full job + budget
  next <id>                              advance one step (stops at approval gates)
  draft <id> | submit <id> | render <id> | publish <id> | resume <id>
  edit <id> "<text>"                     replace draft text by hand
  approve <id> [--by name] [--note ..]   approve the current gate
  reject <id> [--note ..]                send back to drafted
  approve-spend <id> <text|image|video>  allow paid calls of that category for this job
  budget                                 project spend vs ceilings
  ledger                                 raw spend ledger
  feed                                   public feed JSON
  check "<text>"                         run the safety policy on some text
  status                                 switches, providers, warnings
`;

function flags(args) {
  const out = { _: [] };
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) out[args[i].slice(2)] = args[++i];
    else out._.push(args[i]);
  }
  return out;
}

const summary = (j) => ({ id: j.id, kind: j.kind, status: j.status, gate: j.gate, draft: j.draft?.text, safety: j.draft?.safety, error: j.error?.message, publication: j.publication });

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const f = flags(rest);
  const cfg = loadConfig();
  for (const w of cfg.warnings) console.warn(`WARNING: ${w}`);
  const id = f._[0];
  const print = (x) => console.log(JSON.stringify(x, null, 2));

  switch (cmd) {
    case 'new': {
      const [kind, ...brief] = f._;
      const budget = {};
      if (f['video-budget']) budget.video = Number(f['video-budget']);
      if (f['image-budget']) budget.image = Number(f['image-budget']);
      return print(summary(engine.newJob(cfg, { kind, brief: brief.join(' '), budget, options: { shots: f.shots, seconds: f.seconds } })));
    }
    case 'list': return print(listJobs(cfg).map(summary));
    case 'show': { const j = loadJob(cfg, id); return print({ job: j, budget: budgetReport(cfg, j) }); }
    case 'next': case 'draft': case 'submit': case 'render': case 'publish': case 'resume':
      return print(summary(await engine[cmd](cfg, id)));
    case 'edit': return print(summary(engine.editDraft(cfg, id, f._.slice(1).join(' '))));
    case 'approve': return print(summary(engine.approve(cfg, id, { by: f.by, note: f.note })));
    case 'reject': return print(summary(engine.reject(cfg, id, { by: f.by, note: f.note })));
    case 'approve-spend': return print(summary(engine.approveSpend(cfg, id, f._[1], { by: f.by })));
    case 'budget': return print(budgetReport(cfg));
    case 'ledger': return print(ledger(cfg));
    case 'feed': return print(readFeed(cfg));
    case 'check': return print(checkContent(f._.join(' ')));
    case 'status': return print({ dryRun: cfg.dryRun, allowPaidCalls: cfg.allowPaidCalls, publishEnabled: cfg.x.publishEnabled, feeWallet: cfg.feeWallet.solanaAddress || null, providers: providerStatus(cfg) });
    default: console.log(HELP);
  }
}

main().catch((err) => { console.error(`error: ${err.message}`); process.exit(1); });
