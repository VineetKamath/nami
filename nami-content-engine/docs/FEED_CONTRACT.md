# Feed contract (v1)

The public website reads published content from the engine. It never talks to providers.

## Endpoints (public, read-only, CORS via `CORS_ORIGIN`)

| Method | Path | Returns |
|---|---|---|
| GET | `/api/health` | `{ ok, dryRun }` |
| GET | `/api/feed` | Feed document (dry-run items hidden) |
| GET | `/api/feed?includeDryRun=1` | Feed including dry-run items (for local preview) |
| GET | `/media/<jobId>/<file>` | Media of **published** jobs only |

If you host the site statically without the engine running, set `FEED_EXPORT_PATH`
(e.g. `../public/data/feed.json`) and the same document is written there on every publish.
That static copy includes dry-run items, so filter on `dryRun` in the site.

## Feed document

```json
{
  "version": 1,
  "generatedAt": "2026-10-14T08:28:00.463Z",
  "items": [
    {
      "id": "2026-10-14-video-8ba71b",
      "kind": "post | video",
      "text": "post text as published",
      "media": [
        { "type": "image", "role": "poster", "url": "https://…/media/<id>/plate-1.png", "alt": "…" },
        { "type": "video", "role": "main", "url": "https://…/media/<id>/final.mp4", "mime": "video/mp4", "durationSeconds": 12 }
      ],
      "publishedAt": "ISO-8601",
      "platform": "x",
      "postUrl": "https://x.com/i/web/status/… | null",
      "dryRun": false
    }
  ]
}
```

Rules for consumers:
- Items are newest first. `id` is stable; use it as a key.
- `media` is empty for text posts. Unknown `type` values (e.g. `manifest` while video
  encoding is still a placeholder) must be ignored, not rendered.
- `version` changes only on breaking changes. New optional fields may appear at any time.

## Minimal site snippet

```html
<section id="nami-feed"></section>
<script type="module">
  const FEED = 'http://127.0.0.1:8787/api/feed'; // or '/data/feed.json'
  const { items } = await (await fetch(FEED)).json();
  document.getElementById('nami-feed').replaceChildren(...items.filter((i) => !i.dryRun).map((i) => {
    const el = document.createElement('article');
    const poster = i.media.find((m) => m.role === 'poster');
    const video = i.media.find((m) => m.type === 'video');
    if (video) { const v = document.createElement('video'); v.src = video.url; v.poster = poster?.url || ''; v.controls = true; v.playsInline = true; el.append(v); }
    else if (poster) { const img = document.createElement('img'); img.src = poster.url; img.alt = poster.alt || ''; el.append(img); }
    const p = document.createElement('p'); p.textContent = i.text; el.append(p);
    if (i.postUrl) { const a = document.createElement('a'); a.href = i.postUrl; a.textContent = 'view on X'; el.append(a); }
    return el;
  }));
</script>
```
