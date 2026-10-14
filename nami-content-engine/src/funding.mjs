import path from 'node:path';
import { readJson, writeJsonAtomic } from './store.mjs';

// Read-only watcher for the PUBLIC fee wallet. It never signs or sends anything.
// Every SOL increase it observes is valued in USD at that moment and unlocks a share
// of the image/video budget. Withdrawals are ignored (they don't "un-fund" past receipts).
const LAMPORTS = 1e9;
const stateFile = (cfg) => path.join(cfg.dataDir, 'funding.json');
const EMPTY = { lastLamports: null, receivedLamports: 0, receivedUsd: 0, lastCheckedAt: null, lastPriceUsd: null, events: [] };

export const readFunding = (cfg) => readJson(stateFile(cfg), { ...EMPTY });

async function rpc(cfg, method, params) {
  const res = await fetch(cfg.funding.rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`Solana RPC ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(`Solana RPC: ${data.error.message}`);
  return data.result;
}

export async function solUsdPrice(cfg) {
  if (cfg.funding.priceSource === 'coingecko') {
    try {
      const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
      const price = (await res.json())?.solana?.usd;
      if (Number.isFinite(price) && price > 0) return price;
    } catch { /* fall back below */ }
  }
  if (cfg.funding.solUsdPrice > 0) return cfg.funding.solUsdPrice;
  throw new Error('No SOL/USD price available (set SOL_USD_PRICE as a fallback)');
}

export async function pollFunding(cfg) {
  const state = readFunding(cfg);
  const lamports = Number((await rpc(cfg, 'getBalance', [cfg.feeWallet.solanaAddress, { commitment: 'finalized' }])).value);
  const prev = state.lastLamports ?? (cfg.funding.countExistingBalance ? 0 : lamports);
  const delta = lamports - prev;
  state.lastCheckedAt = new Date().toISOString();
  if (delta > 0) {
    const price = await solUsdPrice(cfg); // throws before we record, so the delta is retried next poll
    const usd = Math.round((delta / LAMPORTS) * price * 100) / 100;
    state.receivedLamports += delta;
    state.receivedUsd = Math.round((state.receivedUsd + usd) * 100) / 100;
    state.lastPriceUsd = price;
    state.events.push({ at: state.lastCheckedAt, sol: delta / LAMPORTS, usd, priceUsd: price });
  }
  state.lastLamports = lamports;
  writeJsonAtomic(stateFile(cfg), state);
  return state;
}

// USD unlocked for a category by fees received so far. null = funding gate not in use.
export function fundedAllocation(cfg, category) {
  if (!cfg.funding.enabled) return null;
  return Math.floor(readFunding(cfg).receivedUsd * (cfg.funding.pct[category] || 0)) / 100;
}
