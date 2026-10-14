import path from 'node:path';
import fs from 'node:fs';
import { createJob, loadJob, saveJob, transition, fail, resume as resumeJob, runStage, jobDir } from './jobs.mjs';
import { callProvider } from './providers/router.mjs';
import { buildLanguageRequest } from './providers/language.mjs';
import { renderPrompt, continuityRules } from './canon.mjs';
import { assertSafe, checkContent } from './safety.mjs';
import { addFeedItem, mediaUrl } from './feed.mjs';
import { CATEGORIES } from './config.mjs';

const filesDir = (cfg, job) => path.join(jobDir(cfg, job.id), 'files');

// Run an action; on unexpected error mark the job failed so it can be resumed.
async function guarded(cfg, job, fn) {
  try {
    return await fn();
  } catch (err) {
    fail(cfg, job, err);
    throw err;
  }
}

export function newJob(cfg, opts) {
  return createJob(cfg, opts);
}

// ---- Drafting -------------------------------------------------------------

function parseStoryboard(text) {
  const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  const sb = JSON.parse(json);
  if (!Array.isArray(sb.shots) || !sb.shots.length || typeof sb.caption !== 'string') throw new Error('Storyboard missing shots or caption');
  sb.shots = sb.shots.map((s, i) => ({ n: i + 1, seconds: Math.min(5, Math.max(2, Number(s.seconds) || 3)), camera: String(s.camera || ''), action: String(s.action || ''), line: String(s.line || '') }));
  return sb;
}

export async function draft(cfg, id) {
  const job = loadJob(cfg, id);
  if (!['planned', 'drafted'].includes(job.status)) throw new Error(`Cannot draft a job in state ${job.status}`);
  return guarded(cfg, job, async () => {
    let draftOut;
    if (job.kind === 'post') {
      const res = await callProvider(cfg, job, 'language', buildLanguageRequest('post', { brief: job.brief }));
      draftOut = { text: res.text.replace(/^["']|["']$/g, '').trim(), provider: res.provider };
    } else {
      const shots = Number(job.options.shots) || 3;
      const seconds = Number(job.options.seconds) || 12;
      const res = await callProvider(cfg, job, 'language', buildLanguageRequest('storyboard', { brief: job.brief, shots, seconds }));
      const sb = parseStoryboard(res.text);
      draftOut = { text: sb.caption, storyboard: sb, provider: res.provider };
    }
    const safetyText = [draftOut.text, ...(draftOut.storyboard?.shots || []).map((s) => `${s.action} ${s.line}`)].join('\n');
    const safety = checkContent(safetyText);
    job.draft = { ...draftOut, safety, at: new Date().toISOString() };
    transition(cfg, job, 'drafted', `drafted by ${draftOut.provider}`);
    if (safety.ok) return submit(cfg, job.id);
    return job; // stays drafted; safety issues are on job.draft.safety
  });
}

// Edit the draft text by hand (still safety-checked).
export function editDraft(cfg, id, text) {
  const job = loadJob(cfg, id);
  if (!['drafted', 'awaiting_approval'].includes(job.status)) throw new Error(`Cannot edit a job in state ${job.status}`);
  job.draft = { ...(job.draft || {}), text, provider: 'human', safety: checkContent(text), at: new Date().toISOString() };
  if (job.draft.storyboard) job.draft.storyboard.caption = text;
  if (job.status === 'awaiting_approval') return transition(cfg, job, 'drafted', 'edited');
  return saveJob(cfg, job);
}

export function submit(cfg, id) {
  const job = loadJob(cfg, id);
  if (job.status !== 'drafted') throw new Error(`Cannot submit a job in state ${job.status}`);
  if (!job.draft) throw new Error('Nothing drafted');
  assertSafe(job.draft.text);
  job.gate = job.kind === 'post' ? 'draft' : 'storyboard';
  return transition(cfg, job, 'awaiting_approval', `gate: ${job.gate}`);
}

// ---- Approvals ------------------------------------------------------------

export function approve(cfg, id, { by = 'operator', note = '' } = {}) {
  const job = loadJob(cfg, id);
  if (job.status !== 'awaiting_approval') throw new Error(`Job ${id} is ${job.status}, not awaiting_approval`);
  assertSafe(job.draft.text);
  job.approvals.push({ gate: job.gate, by, note, at: new Date().toISOString() });
  // Approving a storyboard approves spending on plates and clips, up to the job ceilings.
  if (job.gate === 'storyboard') job.spendApproved = { ...job.spendApproved, image: true, video: true };
  return transition(cfg, job, 'approved', `approved ${job.gate} by ${by}`);
}

export function reject(cfg, id, { by = 'operator', note = '' } = {}) {
  const job = loadJob(cfg, id);
  if (job.status !== 'awaiting_approval') throw new Error(`Job ${id} is ${job.status}, not awaiting_approval`);
  job.approvals.push({ gate: job.gate, by, note, rejected: true, at: new Date().toISOString() });
  if (job.gate === 'pilot') { delete job.stages['clip-1']; }
  if (job.gate === 'final') { for (const k of Object.keys(job.stages)) if (!k.startsWith('plate-') && k !== 'clip-1') delete job.stages[k]; }
  job.gate = job.gate === 'draft' || job.gate === 'storyboard' ? job.gate : 'storyboard';
  return transition(cfg, job, 'drafted', `rejected: ${note}`);
}

export function approveSpend(cfg, id, category, { by = 'operator' } = {}) {
  if (!CATEGORIES.includes(category)) throw new Error(`category must be one of ${CATEGORIES.join(', ')}`);
  const job = loadJob(cfg, id);
  if (job.status === 'published') throw new Error('Job already published');
  job.spendApproved[category] = true;
  job.approvals.push({ gate: `spend:${category}`, by, at: new Date().toISOString() });
  return saveJob(cfg, job);
}

// ---- Premium video pipeline (video jobs only) -----------------------------

export async function render(cfg, id) {
  const job = loadJob(cfg, id);
  if (job.kind !== 'video') throw new Error('Only video jobs render. Posts go straight from approved to published.');
  if (job.status !== 'approved') throw new Error(`Job ${id} is ${job.status}, not approved`);
  const phase = { storyboard: 'pilot', pilot: 'final' }[job.gate];
  if (!phase) throw new Error(`Nothing to render after gate ${job.gate}; publish instead`);
  transition(cfg, job, 'rendering', `phase: ${phase}`);

  return guarded(cfg, job, async () => {
    const sb = job.draft.storyboard;
    const out = filesDir(cfg, job);
    const rules = continuityRules();
    const plateFor = (shot) => runStage(cfg, job, `plate-${shot.n}`, async () => {
      const r = await callProvider(cfg, job, 'image', { name: `plate-${shot.n}`, outDir: out, prompt: renderPrompt('plate', { action: shot.action, camera: shot.camera, continuity: rules }) });
      return { file: path.basename(r.file), mime: r.mime, provider: r.provider };
    });
    const clipFor = (shot, plate) => runStage(cfg, job, `clip-${shot.n}`, async () => {
      const r = await callProvider(cfg, job, 'video', { name: `clip-${shot.n}`, outDir: out, seconds: shot.seconds, plate: plate.file, prompt: `${shot.camera}. ${shot.action}. ${rules}` });
      return { file: path.basename(r.file), mime: r.mime, seconds: shot.seconds, provider: r.provider };
    });

    if (phase === 'pilot') {
      // Still plates for every shot, then one pilot clip before committing the bulk of the video budget.
      for (const shot of sb.shots) await plateFor(shot);
      await clipFor(sb.shots[0], job.stages['plate-1'].output);
    } else {
      for (const shot of sb.shots) await clipFor(shot, await plateFor(shot));
      await runStage(cfg, job, 'captions', async () => {
        let t = 0;
        const ts = (s) => new Date(s * 1000).toISOString().slice(11, 23).replace('.', ',');
        const srt = sb.shots.filter((s) => s.line).map((s, i) => {
          const start = sb.shots.slice(0, s.n - 1).reduce((a, x) => a + x.seconds, 0);
          t = start + s.seconds;
          return `${i + 1}\n${ts(start)} --> ${ts(t)}\n${s.line}\n`;
        }).join('\n');
        fs.writeFileSync(path.join(out, 'captions.srt'), srt);
        return { file: 'captions.srt' };
      });
      await runStage(cfg, job, 'graphics', async () => {
        const title = sb.title.replace(/[<>&]/g, '');
        fs.writeFileSync(path.join(out, 'title-card.svg'), `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920"><rect width="1080" height="1920" fill="#0b1026"/><text x="540" y="960" fill="#2ec4c4" font-family="sans-serif" font-size="64" text-anchor="middle">${title}</text></svg>\n`);
        return { file: 'title-card.svg' };
      });
      await runStage(cfg, job, 'export', async () => {
        const clips = sb.shots.map((s) => job.stages[`clip-${s.n}`].output);
        const manifest = {
          format: { width: 1080, height: 1920, fps: 24, container: 'mp4' },
          durationSeconds: clips.reduce((a, c) => a + c.seconds, 0),
          clips: clips.map((c) => c.file), captions: 'captions.srt', titleCard: 'title-card.svg',
          poster: job.stages['plate-1'].output.file,
          placeholder: clips.some((c) => c.file.endsWith('.clip.json')),
          note: 'Edit/encode step (ffmpeg or NLE) assembles these into final.mp4.',
        };
        fs.writeFileSync(path.join(out, 'final.json'), JSON.stringify(manifest, null, 2));
        return { file: 'final.json', ...manifest };
      });
    }
    transition(cfg, job, 'rendered', `${phase} rendered`);
    job.gate = phase;
    return transition(cfg, job, 'awaiting_approval', `gate: ${phase}`);
  });
}

// ---- Publishing -----------------------------------------------------------

export async function publish(cfg, id) {
  const job = loadJob(cfg, id);
  if (job.status !== 'approved') throw new Error(`Job ${id} is ${job.status}, not approved`);
  const needed = job.kind === 'post' ? 'draft' : 'final';
  if (job.gate !== needed) throw new Error(`Job must be approved at the "${needed}" gate before publishing (current: ${job.gate})`);
  const text = assertSafe(job.draft.text); // re-check at the last moment

  return guarded(cfg, job, async () => {
    const res = await callProvider(cfg, job, 'publisher', { text });
    const media = [];
    if (job.kind === 'video') {
      const exp = job.stages.export.output;
      media.push({ type: 'image', role: 'poster', url: mediaUrl(cfg, job.id, exp.poster), alt: job.draft.storyboard.title });
      const finalMp4 = path.join(filesDir(cfg, job), 'final.mp4');
      media.push(fs.existsSync(finalMp4)
        ? { type: 'video', role: 'main', url: mediaUrl(cfg, job.id, 'final.mp4'), mime: 'video/mp4', durationSeconds: exp.durationSeconds }
        : { type: 'manifest', role: 'main', url: mediaUrl(cfg, job.id, 'final.json'), mime: 'application/json', placeholder: true });
    }
    const publishedAt = new Date().toISOString();
    job.publication = { provider: res.provider, postId: res.id, url: res.url, dryRun: res.dryRun, at: publishedAt };
    addFeedItem(cfg, {
      id: job.id, kind: job.kind, text, media, publishedAt,
      platform: 'x', postUrl: res.url, dryRun: res.dryRun,
    });
    return transition(cfg, job, 'published', `via ${res.provider}${res.dryRun ? ' (dry run)' : ''}`);
  });
}

export function resume(cfg, id) {
  return resumeJob(cfg, loadJob(cfg, id));
}

// Advance a job one step along its happy path, stopping at human gates.
export async function next(cfg, id) {
  const job = loadJob(cfg, id);
  if (job.status === 'planned') return draft(cfg, id);
  if (job.status === 'drafted') return draft(cfg, id);
  if (job.status === 'approved') return job.kind === 'video' && job.gate !== 'final' ? render(cfg, id) : publish(cfg, id);
  if (job.status === 'failed') return resume(cfg, id);
  return job; // awaiting_approval / published: nothing automatic to do
}
