import { systemPrompt, renderPrompt } from '../canon.mjs';

// Free, offline drafter. Keeps dry-run and $0 text budgets fully functional.
const OPENERS = ['rain on the studio window again.', 'late shift in the studio.', 'cassette rewinding, kettle on.', 'city lights doing that blurry thing tonight.', 'quiet hour in the studio.'];
const CLOSERS = ['what are you listening to right now?', 'tell me yours.', 'which one would you pick?', 'how is your night going?', 'what would you add?'];

function pick(list, seed) {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return list[h % list.length];
}

function templateRun(req) {
  const seed = req.vars?.brief || req.prompt;
  if (req.promptName === 'storyboard') {
    const shots = Number(req.vars.shots) || 3;
    const per = Math.max(2, Math.round((Number(req.vars.seconds) || 12) / shots));
    const actions = ['looks up from the CRT monitor and smiles slightly', 'turns toward the rainy window, city lights reflected in the glass', 'slides a cassette into the deck and leans back', 'speaks to camera, warm and calm', 'reaches toward the lamp and dims it'];
    const storyboard = {
      title: req.vars.brief.slice(0, 60),
      caption: `${pick(OPENERS, seed)} ${req.vars.brief.toLowerCase().replace(/[.!?]+$/, '')}. ${pick(CLOSERS, seed)}`.slice(0, 240),
      shots: Array.from({ length: shots }, (_, i) => ({
        n: i + 1, seconds: per,
        camera: i === 0 ? 'slow push-in, medium close-up' : 'gentle parallax, medium shot',
        action: actions[i % actions.length],
        line: i === shots - 1 ? pick(CLOSERS, seed) : '',
      })),
    };
    return { text: JSON.stringify(storyboard), costUsd: 0 };
  }
  const text = `${pick(OPENERS, seed)} ${seed.toLowerCase().replace(/[.!?]+$/, '')}. ${pick(CLOSERS, seed + 'x')}`;
  return { text: text.slice(0, 240), costUsd: 0 };
}

export const templateLanguage = {
  name: 'template',
  category: 'text',
  paid: false,
  available: () => true,
  estimate: () => 0,
  run: async (req) => templateRun(req),
};

export const openaiLanguage = {
  name: 'openai',
  category: 'text',
  paid: true,
  available: (cfg) => Boolean(cfg.openai.apiKey),
  estimate: (_req, cfg) => cfg.openai.estCostPerCall,
  async run(req, { cfg }) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.openai.apiKey}` },
      body: JSON.stringify({
        model: cfg.openai.model,
        max_tokens: req.promptName === 'storyboard' ? 700 : 120, // caps actual spend near the estimate
        temperature: 0.8,
        messages: [{ role: 'system', content: systemPrompt() }, { role: 'user', content: req.prompt }],
      }),
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    return { text: data.choices?.[0]?.message?.content?.trim() || '', costUsd: cfg.openai.estCostPerCall };
  },
};

export function buildLanguageRequest(promptName, vars) {
  return { promptName, vars, prompt: renderPrompt(promptName, vars) };
}
