import fs from 'node:fs';
import path from 'node:path';

const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

// Free placeholder: an SVG card describing the plate, so the pipeline and site can be tested end to end.
export const placeholderImage = {
  name: 'placeholder-image',
  category: 'image',
  paid: false,
  available: () => true,
  estimate: () => 0,
  async run(req) {
    const file = path.join(req.outDir, `${req.name}.svg`);
    fs.mkdirSync(req.outDir, { recursive: true });
    fs.writeFileSync(file, `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b1026"/><stop offset="1" stop-color="#1b2a4a"/></linearGradient></defs>
<rect width="1080" height="1920" fill="url(#g)"/><circle cx="540" cy="760" r="220" fill="#2ec4c4" opacity=".25"/>
<text x="540" y="1200" fill="#e9f6f6" font-family="sans-serif" font-size="44" text-anchor="middle">PLACEHOLDER PLATE · ${esc(req.name)}</text>
<foreignObject x="90" y="1260" width="900" height="500"><div xmlns="http://www.w3.org/1999/xhtml" style="color:#9fb3c8;font:32px sans-serif">${esc(req.prompt.slice(0, 300))}</div></foreignObject>
</svg>\n`);
    return { file, mime: 'image/svg+xml', costUsd: 0 };
  },
};

export const openaiImage = {
  name: 'openai-image',
  category: 'image',
  paid: true,
  available: (cfg) => Boolean(cfg.openai.apiKey),
  estimate: (_req, cfg) => cfg.openai.estCostPerImage,
  async run(req, { cfg }) {
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.openai.apiKey}` },
      body: JSON.stringify({ model: cfg.openai.imageModel, prompt: req.prompt, size: '1024x1536', n: 1 }),
    });
    if (!res.ok) throw new Error(`OpenAI image ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const b64 = (await res.json()).data?.[0]?.b64_json;
    if (!b64) throw new Error('OpenAI image returned no data');
    fs.mkdirSync(req.outDir, { recursive: true });
    const file = path.join(req.outDir, `${req.name}.png`);
    fs.writeFileSync(file, Buffer.from(b64, 'base64'));
    return { file, mime: 'image/png', costUsd: cfg.openai.estCostPerImage };
  },
};
