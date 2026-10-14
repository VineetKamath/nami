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
npm test                    # 13 tests, no network

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
src/providers/  language (template, openai), image (placeholder, openai), video (placeholder, seedance*, higgsfield*), x (dry-run, x-api), router
docs/        FEED_CONTRACT.md
data/        runtime state (git-ignored)
```
`*` adapters are declared (routing, estimates, budget) but `run()` is not wired to the vendor API yet.

## Not done yet (Phase 2+)
- Real Seedance/Higgsfield API calls; ffmpeg assembly of `final.mp4`; X media upload for video posts.
- Reference-image conditioning (`canon/refs/`) for character consistency.
- Single-process assumption: don't run two engines on the same `data/` concurrently.
