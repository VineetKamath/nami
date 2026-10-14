# Nami — Visual Continuity Rules

These rules are injected into every image and video prompt. A plate or clip that
breaks a **MUST** rule is rejected at review, regardless of how good it looks.

## Character — MUST
1. Adult woman, apparent age 24–28. Never childlike proportions or styling.
2. Hair: teal/cyan (#2EC4C4 ± small variance), shoulder length, soft wave, side part on her right. No other hair colour, length or style.
3. Eyes: amber/gold. Same in every shot.
4. Face: soft oval face, small beauty mark under the left eye.
5. Earring: one small silver crescent moon, **left ear only**.
6. Default wardrobe: oversized charcoal tech jacket, white crew-neck top. Wardrobe changes only if the job brief names one explicitly.
7. Fully clothed, non-sexualised framing at all times.

## Style — MUST
- Anime-influenced semi-realism, cinematic, shallow depth of field.
- Palette: deep navy shadows, teal and magenta practical lights, warm amber accents.
- No text, logos, watermarks or UI baked into plates (graphics are added in post).
- No crypto symbols, coins, charts, tickers or wallet imagery.

## Studio set — SHOULD
- Rain-streaked window over a night city (left of frame), CRT monitor glow, cassette shelf, small plant.
- Time is always night or blue hour unless the brief says otherwise.

## Camera & format
- Social export: 1080×1920 (9:16), 24 fps, ≤ 30 s for standard pieces.
- Shots 2–5 s each. Prefer slow push-ins, gentle parallax, rack focus. No whip pans.
- Keep her eye-line consistent across cuts within a scene.

## Continuity workflow
1. **Reference sheet**: approved turnaround images live in `canon/refs/` (not committed until approved). Every image call passes the reference(s).
2. **Storyboard** (text) → human approval.
3. **Still plates** per shot → check against rules 1–7.
4. **Pilot clip** (first shot only) → human approval before spending on remaining shots.
5. **Full clips → captions/graphics → final export** → human approval before publishing.
