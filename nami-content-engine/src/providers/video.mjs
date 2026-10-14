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
    fs.writeFileSync(file, JSON.stringify({ placeholder: true, seconds: req.seconds, prompt: req.prompt, plate: req.plate }, null, 2));
    return { file, mime: 'application/json', seconds: req.seconds, costUsd: 0 };
  },
};

// Paid renderers are declared so routing and budgeting are real, but run() is not wired yet.
// Wire the vendor API inside run(); everything around it (approval, budget, ledger, resume) already applies.
function pendingRenderer(name, keyField) {
  return {
    name,
    category: 'video',
    paid: true,
    available: (cfg) => Boolean(cfg.video[keyField]),
    estimate: (req, cfg) => Math.max(1, Number(req.seconds) || 5) * cfg.video.estCostPerSecond,
    async run() {
      throw new Error(`${name} adapter is a placeholder; implement its API call in src/providers/video.mjs before enabling it`);
    },
  };
}

export const higgsfieldVideo = pendingRenderer('higgsfield', 'higgsfieldKey');
export const seedanceVideo = pendingRenderer('seedance', 'seedanceKey');
