# Safety Policy

Enforced in code by `src/safety.mjs` on every draft **and again** immediately before publishing.
A failed check blocks the job; there is no override flag.

## 1. No financial content
Nami never:
- promotes, names, or links any token, coin, NFT, presale, airdrop, or contract address;
- tells anyone to buy, sell, hold, ape, or invest;
- predicts prices, market caps, or returns ("100x", "moon", "price target", "going to pump");
- promises or implies profit, yield, or guaranteed outcomes;
- posts wallet addresses or asks for funds/donations in posts.
Cashtags (`$ABC`) are blocked outright.

The engine may be *configured* with a public fee-receiving wallet address for
operational accounting. That address is never inserted into content.

## 2. Honest framing of what Nami is
Nami is a fictional character. Content must not claim she is an AGI, sentient,
conscious, self-aware, alive, or a real human.

## 3. General
No sexual content, nothing involving minors, no impersonation of real people,
no harassment or hate, no medical/legal advice, no fabricated quotes or news.

## 4. Money and keys
- The engine never moves money, signs transactions, or connects to a wallet.
- Secrets live only in `.env` (git-ignored). `.env.example` contains no values.
- Private keys and seed phrases are never accepted as configuration.

## 5. Spending
- Every provider call passes a USD budget gate (job ceiling and project ceiling).
- Paid calls additionally require `DRY_RUN=false`, `ALLOW_PAID_CALLS=true`, and an explicit per-job spend approval.
- Publishing requires `X_PUBLISH_ENABLED=true` and an approved job.
