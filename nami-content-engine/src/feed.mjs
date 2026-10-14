import path from 'node:path';
import { readJson, writeJsonAtomic } from './store.mjs';

// Public feed contract (v1). See docs/FEED_CONTRACT.md.
export const FEED_VERSION = 1;
const feedFile = (cfg) => path.join(cfg.dataDir, 'feed.json');

export function readFeed(cfg) {
  return readJson(feedFile(cfg), { version: FEED_VERSION, generatedAt: null, items: [] });
}

export function addFeedItem(cfg, item) {
  const feed = readFeed(cfg);
  feed.items = [item, ...feed.items.filter((i) => i.id !== item.id)];
  feed.generatedAt = new Date().toISOString();
  writeJsonAtomic(feedFile(cfg), feed);
  if (cfg.feedExportPath) writeJsonAtomic(cfg.feedExportPath, feed);
  return feed;
}

export function mediaUrl(cfg, jobId, file) {
  return `${cfg.server.publicBaseUrl}/media/${jobId}/${encodeURIComponent(path.basename(file))}`;
}
