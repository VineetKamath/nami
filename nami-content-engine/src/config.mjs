import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CATEGORIES = ['text', 'image', 'video'];

// Minimal .env loader (no dependency). Real env vars win over the file.
export function loadDotEnv(file = path.join(ROOT, '.env')) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    let value = line.slice(eq + 1).trim();
    if (/^["']/.test(value)) value = value.slice(1, value.lastIndexOf(value[0]) > 0 ? value.lastIndexOf(value[0]) : undefined);
    else value = value.replace(/\s+#.*$/, '');
    out[line.slice(0, eq).trim()] = value;
  }
  return out;
}

const bool = (v, d) => (v === undefined || v === '' ? d : /^(1|true|yes|on)$/i.test(String(v)));
function usd(v, d) {
  if (v === undefined || v === '') return d;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid USD amount: ${v}`);
  return n;
}

const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SECRET_KEY_NAMES = /^(SOLANA_PRIVATE_KEY|SOLANA_SECRET_KEY|WALLET_PRIVATE_KEY|PRIVATE_KEY|SEED_PHRASE|MNEMONIC)$/i;

export function loadConfig(overrides = {}) {
  const env = { ...loadDotEnv(overrides.envFile), ...process.env, ...overrides.env };
  const warnings = [];

  for (const k of Object.keys(env)) {
    if (SECRET_KEY_NAMES.test(k) && env[k]) {
      warnings.push(`${k} is set but is never read. This engine does not sign transactions; remove the key from your environment.`);
    }
  }

  const feeWallet = env.SOLANA_FEE_WALLET_ADDRESS || '';
  if (feeWallet && !SOLANA_ADDRESS.test(feeWallet)) {
    // A base58 private key is ~88 chars, so this also catches a key pasted into the wrong slot.
    throw new Error('SOLANA_FEE_WALLET_ADDRESS must be a public Solana address (32-44 base58 chars). Never put a private key here.');
  }

  const cfg = {
    root: ROOT,
    dataDir: path.resolve(ROOT, env.DATA_DIR || './data'),
    dryRun: bool(env.DRY_RUN, true),
    allowPaidCalls: bool(env.ALLOW_PAID_CALLS, false),
    jobBudget: {
      text: usd(env.JOB_BUDGET_TEXT_USD, 0),
      image: usd(env.JOB_BUDGET_IMAGE_USD, 5),
      video: usd(env.JOB_BUDGET_VIDEO_USD, 75),
    },
    projectBudget: {
      text: usd(env.PROJECT_BUDGET_TEXT_USD, 0),
      image: usd(env.PROJECT_BUDGET_IMAGE_USD, 5),
      video: usd(env.PROJECT_BUDGET_VIDEO_USD, 75),
    },
    openai: {
      apiKey: env.OPENAI_API_KEY || '',
      model: env.OPENAI_MODEL || 'gpt-4o-mini',
      estCostPerCall: usd(env.OPENAI_EST_COST_PER_CALL_USD, 0.002),
      imageModel: env.OPENAI_IMAGE_MODEL || 'gpt-image-1',
      estCostPerImage: usd(env.OPENAI_EST_COST_PER_IMAGE_USD, 0.07),
    },
    x: {
      apiKey: env.X_API_KEY || '',
      apiSecret: env.X_API_SECRET || '',
      accessToken: env.X_ACCESS_TOKEN || '',
      accessSecret: env.X_ACCESS_SECRET || '',
      publishEnabled: bool(env.X_PUBLISH_ENABLED, false),
      estCostPerPost: usd(env.X_EST_COST_PER_POST_USD, 0),
    },
    video: {
      higgsfieldKey: env.HIGGSFIELD_API_KEY || '',
      seedanceKey: env.SEEDANCE_API_KEY || '',
      estCostPerSecond: usd(env.VIDEO_EST_COST_PER_SECOND_USD, 0.5),
    },
    feeWallet: { solanaAddress: feeWallet },
    server: {
      host: env.HOST || '127.0.0.1',
      port: Number(env.PORT || 8787),
      adminToken: env.ADMIN_TOKEN || '',
      corsOrigin: env.CORS_ORIGIN || '*',
      publicBaseUrl: (env.PUBLIC_BASE_URL || `http://127.0.0.1:${env.PORT || 8787}`).replace(/\/$/, ''),
    },
    feedExportPath: env.FEED_EXPORT_PATH ? path.resolve(ROOT, env.FEED_EXPORT_PATH) : '',
    warnings,
  };

  for (const c of CATEGORIES) {
    if (cfg.jobBudget[c] > cfg.projectBudget[c]) {
      warnings.push(`JOB_BUDGET_${c.toUpperCase()}_USD exceeds the project ceiling; jobs are capped at ${cfg.projectBudget[c]}.`);
      cfg.jobBudget[c] = cfg.projectBudget[c];
    }
  }
  return cfg;
}

// Paid calls need all three switches; publishing has its own switch.
export const paidCallsEnabled = (cfg) => !cfg.dryRun && cfg.allowPaidCalls;
export const publishingEnabled = (cfg) => !cfg.dryRun && cfg.x.publishEnabled;
