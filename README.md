# lemonlolly Content Hub

Takes a client's monthly content calendar and gets it into Buffer as drafts,
with the right imagery from the client's Google Drive.

Phase 1 covers:
- Google sign-in (limited to an email allowlist)
- clients and brand profiles
- calendar import (`.xlsx` / `.csv`) and table view
- Drive library with AI tags
- automatic image matching and a review board
- image preparation (crop, resize, host)
- Buffer push as drafts, with a Buffer CSV fallback

## Running a month end to end

1. **Clients → (client) → Settings**
   - First time only: set the Drive folder link and click **Test Drive connection**.
   - Save the Buffer API key, click **Test Buffer & load channels**, then map Instagram, Facebook and any other platforms to their Buffer channels.
   - Check the posting-time table and the placeholder image URL.
2. **Library**
   - Click **Sync from Drive**. New or changed images are tagged by Claude automatically. Only new or changed files are re-analysed.
3. **Calendar**
   - Click **Import calendar** and choose the month's `.xlsx`.
   - Check the column mapping (it's remembered for next month) and click **Import**.
   - Fix anything flagged red in the table. Grey times are suggestions from the posting-time rules.
4. **Match imagery →**
   - Posts are matched in batches, with a progress bar.
5. **Review imagery**
   - Posts are sorted lowest confidence first.
   - **Approve**, **Swap** (search the library; carousels keep an ordered set) or **No image**.
   - **Approve all ≥ 80%** clears the confident matches in one click.
   - Your swaps teach future matching for this client.
6. **Prepare approved images →**
   - Crops and resizes to 1080×1350 (feed), 1080×1080 (square) or 1080×1920 (story/reel).
   - Converts HEIC, strips location data and uploads to public URLs.
   - Use **Adjust crop** on any image to override the smart crop.
7. **Push to Buffer**
   - Check the preview. Every post shows its checks: placeholders, 2,200-character Instagram limit, Instagram image, times, duplicate times and channel mapping.
   - Blocked posts can't be ticked.
   - Leave **Drafts** selected and click **Send**. Re-sending updates the same Buffer drafts.
   - **CSV fallback:** download one file per channel and upload it in Buffer (Publish → channel → ⚙ → General → Bulk Upload → **Save as Drafts**). Carousels, reels, stories and videos are listed for manual setup.
8. **Activity log** records every Drive, Claude and Buffer call, with any errors.

## Guardrails

- **Drive:** read-only (`drive.readonly` scope only).
- **Buffer:**
  - Pushes create drafts unless you tick "Schedule" and type `SCHEDULE` for that push.
  - Instagram posts are never sent without an image.
- **Captions:** marked approved in the calendar, they can't be edited in the app. Captions are always used verbatim.
- **Secrets:** Buffer and Klaviyo keys are stored AES-256-GCM encrypted and never sent to the browser.
- **Database:** Row Level Security is on for every table with no policies, so only the server (service-role key) can read data.

## Setup

See `.env.example` for every setting. Locally:

```bash
npm install
cp .env.example .env.local   # then fill it in
sh scripts/set-google-key.sh ~/Downloads/<service-account-key>.json
npm run dev                  # http://localhost:3000
```

Database: run `supabase/migrations/0001_init.sql` once in Supabase → SQL Editor. It creates the tables and the storage buckets (`rendered` is public; `thumbs` and `imports` are private).

Checks: `npm test`, `npm run typecheck`, `npm run lint`.

## How long jobs work

Drive indexing, AI tagging, matching, image preparation and Buffer pushes are stored as `jobs` rows. The open page calls `/api/jobs/:id/step` repeatedly, and each call does a small batch (a few items), so nothing hits Vercel's time limit. If the tab closes or a call fails, the job shows **Resume** and carries on from where it stopped.

## Reference

- `docs/buffer-api-notes.md`: what the Buffer API supports (checked Sept 2026).
- The Claude model is set in `src/lib/config.ts` (`CLAUDE_MODEL` env var overrides it).
