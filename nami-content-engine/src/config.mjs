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

function num(v, d) {
  if (v === undefined || v === '') return d;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid number: ${v}`);
  return n;
}
function parseJson(v, name) {
  if (!v) return {};
  try { return JSON.parse(v); } catch { throw new Error(`${name} must be a JSON object`); }
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
      estCostPerSecond: usd(env.VIDEO_EST_COST_PER_SECOND_USD, 0.5),
    },
    higgsfield: {
      apiKey: env.HIGGSFIELD_API_KEY || '',
      apiSecret: env.HIGGSFIELD_API_SECRET || '',
      baseUrl: (env.HIGGSFIELD_BASE_URL || 'https://platform.higgsfield.ai').replace(/\/$/, ''),
      videoModel: (env.HIGGSFIELD_VIDEO_MODEL || '').replace(/^\//, ''),
      extraParams: parseJson(env.HIGGSFIELD_EXTRA_PARAMS, 'HIGGSFIELD_EXTRA_PARAMS'),
      pollSeconds: num(env.HIGGSFIELD_POLL_SECONDS, 10),
      timeoutMinutes: num(env.HIGGSFIELD_TIMEOUT_MINUTES, 20),
    },
    referenceImageUrl: env.NAMI_REFERENCE_IMAGE_URL || '',
    feeWallet: { solanaAddress: feeWallet },
    funding: {
      enabled: bool(env.FUNDING_WATCH_ENABLED, false),
      rpcUrl: env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
      priceSource: env.SOL_PRICE_SOURCE || 'coingecko', // coingecko | fixed
      solUsdPrice: usd(env.SOL_USD_PRICE, 0),           // used when fixed, or as fallback
      countExistingBalance: bool(env.FUNDING_COUNT_EXISTING_BALANCE, true),
      pct: { text: 0, image: num(env.FUNDING_IMAGE_PCT, 10), video: num(env.FUNDING_VIDEO_PCT, 80) },
    },
    autopilot: {
      enabled: bool(env.AUTOPILOT_ENABLED, false),
      intervalSeconds: Math.max(15, num(env.AUTOPILOT_INTERVAL_SECONDS, 60)),
      requirePilotApproval: bool(env.AUTOPILOT_REQUIRE_PILOT_APPROVAL, true),
      maxRetries: num(env.AUTOPILOT_MAX_RETRIES, 3),
    },
    progress: { showPreviews: bool(env.PROGRESS_SHOW_PREVIEWS, false) },
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

  if (cfg.funding.enabled && !feeWallet) throw new Error('FUNDING_WATCH_ENABLED needs SOLANA_FEE_WALLET_ADDRESS');
  if (cfg.funding.pct.image + cfg.funding.pct.video > 100) throw new Error('FUNDING_IMAGE_PCT + FUNDING_VIDEO_PCT must be <= 100');

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
