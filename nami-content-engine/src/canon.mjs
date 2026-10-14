import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.mjs';

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

export const canon = {
  bible: () => read('canon/NAMI_BIBLE.md'),
  continuity: () => read('canon/VISUAL_CONTINUITY.md'),
  safety: () => read('canon/SAFETY_POLICY.md'),
};

export function systemPrompt() {
  return [canon.bible(), canon.safety()].join('\n\n---\n\n');
}

// Prompt library: prompts/<name>.md with {{var}} placeholders.
export function renderPrompt(name, vars = {}) {
  const tpl = read(`prompts/${name}.md`);
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => {
    if (!(k in vars)) throw new Error(`Prompt ${name} needs variable "${k}"`);
    return String(vars[k]);
  });
}

// Short continuity block for image/video prompts: just the MUST rules.
export function continuityRules() {
  const text = canon.continuity();
  const start = text.indexOf('## Character');
  const end = text.indexOf('## Studio set');
  return text.slice(start, end).trim();
}
