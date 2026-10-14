// Hard content gate. Applied on draft and again right before publish. No override.
const RULES = [
  ['cashtag', /\$[A-Za-z][A-Za-z0-9]{1,9}\b/],
  ['token promotion', /\b(token|memecoin|shitcoin|altcoin|coin launch|presale|pre-sale|airdrop|ico|ido|nft drop|mint(ing)? now|pump\.fun|bonding curve|dex ?screener|raydium|jupiter swap)\b/i],
  ['trade instruction', /\b(buy|sell|hodl|ape(d)? in|ape into|load(ing)? up|accumulate|dca)\b.{0,30}\b(now|today|this|it|before|while|token|coin|bag)\b/i],
  ['price talk', /\b(price target|market ?cap|mcap|to the moon|mooning|moon soon|\d+\s?x\b|100x|1000x|pump(ing)?|dump(ing)?|all[- ]time high|ath|bullish|bearish|undervalued)\b/i],
  ['return promise', /\b(guaranteed|risk[- ]free|passive income|profit|guaranteed returns?|yield|apy|apr|get rich|financial freedom)\b/i],
  ['financial advice', /\b(financial advice|nfa|dyor|not advice|invest(ing|ment)?)\b/i],
  ['wallet or address', /\b(wallet|seed phrase|private key|send (sol|eth|btc)|contract address|\bca\b)\b|\b[1-9A-HJ-NP-Za-km-z]{32,44}\b|\b0x[a-fA-F0-9]{40}\b/i],
  ['crypto ticker', /\b(sol|solana|btc|bitcoin|eth|ethereum|crypto)\b/i],
  ['sentience claim', /\b(agi|sentient|sentience|conscious(ness)?|self[- ]aware|i('| a)m alive|i am alive|real feelings|i feel things as an ai|superintelligen\w*)\b/i],
  ['real-human claim', /\b(i('| a)m (a )?real (person|human|girl|woman)|not an? (ai|bot|character))\b/i],
];

export function checkContent(text) {
  const issues = [];
  if (typeof text !== 'string' || !text.trim()) return { ok: false, issues: ['empty content'] };
  for (const [label, re] of RULES) {
    const m = text.match(re);
    if (m) issues.push(`${label}: "${m[0]}"`);
  }
  return { ok: issues.length === 0, issues };
}

export class SafetyError extends Error {
  constructor(issues) {
    super(`Safety policy blocked content: ${issues.join('; ')}`);
    this.name = 'SafetyError';
    this.issues = issues;
  }
}

export function assertSafe(text) {
  const res = checkContent(text);
  if (!res.ok) throw new SafetyError(res.issues);
  return text;
}
