import fs from 'node:fs';
import path from 'node:path';

// Free placeholder: writes a clip manifest instead of a video, so stages, review gates and the feed can be exercised.
export const placeholderVideo = {
  name: 'placeholder-video',
  category: 'video',
  paid: false,
  available: () => true,
  estimate: () => 0,
  async run(req) {
    fs.mkdirSync(req.outDir, { recursive: true });
    const file = path.join(req.outDir, `${req.name}.clip.json`);
    fs.writeFileSync(file, JSON.stringify({ placeholder: true, seconds: req.seconds, prompt: req.prompt, startFrame: req.imageUrl || req.plate }, null, 2));
    return { file, mime: 'application/json', seconds: req.seconds, costUsd: 0 };
  },
};

// Find the first video URL anywhere in a status payload (response shapes differ per model).
export function findVideoUrl(obj) {
  if (typeof obj === 'string') return /^https?:\/\/\S+\.(mp4|mov|webm)(\?\S*)?$/i.test(obj) ? obj : null;
  if (obj && typeof obj === 'object') {
    for (const v of Object.values(obj)) {
      const u = findVideoUrl(v);
      if (u) return u;
    }
  }
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Higgsfield platform API: submit -> poll status_url -> download.
// Seedance, Kling, etc. are chosen with HIGGSFIELD_VIDEO_MODEL (the model path from Higgsfield's catalog).
// Resumable: the request id is persisted via req.onSubmit, and a resumed call polls it instead of paying again.
export const higgsfieldVideo = {
  name: 'higgsfield',
  category: 'video',
  paid: true,
  available: (cfg) => Boolean(cfg.higgsfield.apiKey && cfg.higgsfield.apiSecret && cfg.higgsfield.videoModel),
  estimate: (req, cfg) => (req.pending ? 0 : Math.max(1, Number(req.seconds) || 5) * cfg.video.estCostPerSecond),
  async run(req, { cfg }) {
    const h = cfg.higgsfield;
    const headers = { 'content-type': 'application/json', authorization: `Key ${h.apiKey}:${h.apiSecret}` };
    if (!req.imageUrl) throw new Error('higgsfield needs a start-frame image URL (shot startFrameUrl or NAMI_REFERENCE_IMAGE_URL)');
    let pending = req.pending;
    if (!pending) {
      const res = await fetch(`${h.baseUrl}/${h.videoModel}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ prompt: req.prompt, image_url: req.imageUrl, duration: req.seconds, aspect_ratio: '9:16', ...h.extraParams }),
      });
      if (!res.ok) throw new Error(`Higgsfield submit ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const data = await res.json();
      const requestId = data.request_id || data.id;
      if (!requestId) throw new Error('Higgsfield returned no request_id');
      pending = { requestId, statusUrl: data.status_url || `${h.baseUrl}/requests/${requestId}/status` };
      req.onSubmit?.(pending);
    }
    try {
      const deadline = Date.now() + h.timeoutMinutes * 60_000;
      let videoUrl = null;
      while (!videoUrl) {
        if (Date.now() > deadline) throw new Error(`Higgsfield request ${pending.requestId} still running after ${h.timeoutMinutes} min`);
        const res = await fetch(pending.statusUrl, { headers });
        if (!res.ok) throw new Error(`Higgsfield status ${res.status}`);
        const data = await res.json();
        const status = String(data.status || '').toLowerCase();
        if (['failed', 'nsfw', 'canceled', 'cancelled', 'error'].includes(status)) {
          throw Object.assign(new Error(`Higgsfield request ${status}`), { final: true });
        }
        if (status === 'completed') {
          videoUrl = findVideoUrl(data);
          if (!videoUrl) throw Object.assign(new Error('Higgsfield completed without a video URL'), { final: true });
        } else {
          await sleep(h.pollSeconds * 1000);
        }
      }
      fs.mkdirSync(req.outDir, { recursive: true });
      const file = path.join(req.outDir, `${req.name}.mp4`);
      const dl = await fetch(videoUrl);
      if (!dl.ok) throw new Error(`Download ${dl.status}`);
      fs.writeFileSync(file, Buffer.from(await dl.arrayBuffer()));
      return { file, mime: 'video/mp4', seconds: req.seconds, remoteUrl: videoUrl, requestId: pending.requestId };
    } catch (err) {
      err.charged = true; // once submitted, assume it was billed: never under-count spend
      err.pendingRequest = err.final ? null : pending; // on resume, keep polling the same request unless it is finished
      throw err;
    }
  },
};
