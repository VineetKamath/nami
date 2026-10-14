# nami-content-engine

File-backed content agent for **Nami**, a fictional adult virtual host.
Phase 1: guarded architecture with working dry-run paths. Zero npm dependencies (Node ≥ 20).

- **Claudia-style core**: character canon (`canon/`), prompt library (`prompts/`), job state in files (`data/jobs/<id>/job.json`), provider routing, hard USD budget gates, approvals before paid calls, X publishing, resumable jobs.
- **Slopcore-style video**: storyboard → still plates → pilot clip → review → full clips → captions/graphics → social export → review → publish. Only `video` jobs use it; ordinary `post` jobs get $0 image/video budget.
- **Website stays the presentation layer**: it reads `/api/feed` (or an exported `feed.json`). See `docs/FEED_CONTRACT.md`.

Nothing here launches a token, moves money, signs transactions, or connects to a wallet.

## Run

```bash
cd nami-content-engine
cp .env.example .env        # defaults: DRY_RUN=true, no paid calls, no publishing
npm test                    # 20 tests, no network

# Text post, end to end in dry run (costs $0)
node src/cli.mjs new post "a song recommendation for rainy nights"
node src/cli.mjs next <id>         # drafts -> awaiting_approval (gate: draft)
node src/cli.mjs approve <id>
node src/cli.mjs next <id>         # publishes via x-dry-run, writes data/feed.json

# Premium video, dry run with placeholder plates/clips (costs $0)
node src/cli.mjs new video "nami closes the studio for the night" --shots 3 --video-budget 20
node src/cli.mjs next <id>   # storyboard   -> approve
node src/cli.mjs next <id>   # plates+pilot -> approve
node src/cli.mjs next <id>   # clips, captions, graphics, export -> approve
node src/cli.mjs next <id>   # publish

npm start                    # API on http://127.0.0.1:8787 ; GET /api/feed
```

Other commands: `list`, `show <id>`, `edit <id> "<text>"`, `reject <id> --note ".."`,
`approve-spend <id> <text|image|video>`, `resume <id>`, `budget`, `ledger`, `feed`, `check "<text>"`, `status`.
Admin HTTP endpoints mirror the CLI under `/api/jobs/<id>/<action>` and need `Authorization: Bearer $ADMIN_TOKEN`.

## Funding autopilot: video starts when fees arrive

You need no money up front. Approve the storyboard now, and rendering starts by itself once fees reach the wallet.

1. **Fee wallet watcher** (`src/funding.mjs`): polls the public balance of `SOLANA_FEE_WALLET_ADDRESS` (read-only RPC `getBalance`).
   Every increase is valued in USD and unlocks `FUNDING_VIDEO_PCT` of it as video budget, still capped by `PROJECT_BUDGET_VIDEO_USD`.
2. **Arm a job**: approve its storyboard, then `arm` it. Arming never skips that approval.
3. **Autopilot** (`src/autopilot.mjs`): every minute it checks funding and advances armed jobs.
   It renders the pilot clip on Higgsfield as soon as that clip's cost is covered.
   After pilot approval (or automatically with `AUTOPILOT_REQUIRE_PILOT_APPROVAL=false`), it renders the remaining shots once they are covered.
   Final approval and publishing always stay human.
4. **Progress page**: `/progress` (or `/`) on the engine, backed by public `GET /api/progress`.
   It shows steps, shot tiles, budget unlocked and spent. It shows no prompts, keys or addresses.
   To embed it in the website, copy `site/progress.html` into `public/` and open it with `?api=https://your-engine-host`.

```bash
node src/cli.mjs new video "Signal" --storyboard prompts/storyboards/signal.json   # 12-shot premium film, no LLM needed
node src/cli.mjs next <id>       # loads storyboard -> awaiting_approval
node src/cli.mjs approve <id>    # storyboard approval = permission to spend up to the job ceiling
node src/cli.mjs arm <id>
npm start                        # with AUTOPILOT_ENABLED=true; open http://127.0.0.1:8787/progress
```

Premium jobs never fall back to placeholders. Without budget or config they show "waiting".
Higgsfield request ids are saved before polling, so a crash or restart resumes the same render instead of paying twice.
If `ffmpeg` is installed, the final export concatenates the clips into `final.mp4`.

**Important**: the engine cannot pay Higgsfield with SOL. Fees landing in the wallet unlock the engine's budget.
Your Higgsfield account still needs credits. Claim the fees, convert them, and top up Higgsfield yourself.
Until then, renders fail with a vendor error and the autopilot retries them (up to `AUTOPILOT_MAX_RETRIES`).

## Job states

```
planned -> drafted -> awaiting_approval -> approved -> published            (post)
                          ^                   |
                          |                   v
                          +---- rendered <- rendering                       (video: gates storyboard, pilot, final)
any state -> failed -> (resume) back to where it stopped; finished stages are not redone
```

## Spending guard (all must pass for a paid call)

1. `DRY_RUN=false` and `ALLOW_PAID_CALLS=true`
2. Job has spend approval for the category (`approve-spend`, or approving a video storyboard approves image+video)
3. Image/video paid calls only while the job is `rendering`
4. Estimate fits both the **job** ceiling and the **project** ceiling (ledger in `data/ledger.jsonl`)

If a paid provider is blocked, routing falls back to the free provider (template text, placeholder plates/clips, dry-run publisher).
Publishing to X additionally needs `X_PUBLISH_ENABLED=true` and an approved job; content is re-checked by the safety policy right before posting.

## Layout

```
canon/       NAMI_BIBLE.md, VISUAL_CONTINUITY.md, SAFETY_POLICY.md
prompts/     post.md, storyboard.md, plate.md
src/         config, store, jobs (state machine), budget (ledger + gates), safety, canon, feed, engine, server, cli
src/providers/  language (template, openai), image (placeholder, openai), video (placeholder, higgsfield), x (dry-run, x-api), router
site/        progress.html (public "in production" page)
docs/        FEED_CONTRACT.md
data/        runtime state (git-ignored)
```


## Not done yet (Phase 2+)
- X media upload for video posts; captions burned into the final cut.
- Reference-image conditioning (`canon/refs/`) for character consistency.
- Single-process assumption: don't run two engines on the same `data/` concurrently.
