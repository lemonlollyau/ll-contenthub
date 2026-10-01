# Content calendar format

What a monthly calendar needs to look like to import cleanly into the Content Hub.
There's a ready-made workbook at `templates/content-calendar-template.xlsx`.

## The basics

- **File type:** `.xlsx`, `.xlsm`, `.xls` or `.csv`.
- **Tabs:** every tab with a recognisable header row is imported. A tab whose name
  contains **"Email"** becomes email items; every other tab becomes social posts.
  Tabs with no recognisable headers (Read me, Lists, Dashboard…) are ignored.
- **Header row:** anywhere in the first 15 rows, and it needs at least 3 recognisable
  column names. Everything below it is treated as data.
- **One row per post.** Rows with nothing in Caption, Hook, Asset brief or Subject are skipped,
  so section divider rows like "WEEK 2" do no harm.
- **Column order doesn't matter**, and extra columns of your own are ignored.
  You confirm the column matching on screen before anything is imported, and your
  choices are remembered for that client's next import.

## Columns

Required columns are marked ●. Header names are matched loosely: case, punctuation
and brackets are ignored, so `Caption (draft)` and `caption draft` both work.

### Social tabs

| Column | Also accepted | Notes |
|---|---|---|
| ● `#` | No, Number, Post, ID | Post number. **Keep these stable:** a re-import of the same month updates rows by `#`, which is how approved imagery and Buffer drafts survive. |
| ● `Date` | Post date, Publish date, Go live date | A real Excel date, `YYYY-MM-DD`, `3/11/2026` (day first), or `Tue 3 Nov`. |
| `Time` | Post time, Posting time | 24-hour `18:30`, or `6:30pm`. Leave blank to use the client's posting-time rules. |
| `Day` | Weekday | Optional. Only used to spot Sat/Sun for weekend times. |
| `Phase` | Stage, Week | Your own grouping. |
| `Slot` | AM PM, Time slot | `AM` → 8:00. `PM` → the pillar's evening time. |
| ● `Platform` | Platforms, Channel, Network | `Instagram`, `Facebook`, or several: `Instagram / Facebook`. Also LinkedIn, TikTok, Pinterest, Threads, Twitter/X, YouTube, Google Business. `IG` and `FB` work. |
| ● `Format` | Post type, Type, Content type | Feed, Carousel, Reel, Story, Square, Text. Anything unrecognised becomes Feed. |
| `Pillar` | Content pillar, Theme | Match the pillar names in the client's posting-time table to get that pillar's times. |
| `Moment / Offer` | Moment, Offer, Campaign | Deadline wording here (or in the caption) moves the post to 20:30. |
| `Hook` | Headline, Title | Used for image matching. |
| ● `Caption (draft)` | Caption, Copy, Post copy, Body copy | The caption exactly as it should publish. |
| `Hashtags` | Tags, Hash tags | Added as the last paragraph. |
| `CTA` | Call to action | Added as its own paragraph. |
| `First comment` | Comment | Instagram, Facebook and LinkedIn only. |
| `Asset brief` | Image brief, Visual brief, Creative brief | What you want pictured. For carousels, say how many: "5 slides: …". |
| `Asset group` | Asset folder, Folder | Name of a subfolder in the client's Drive folder to choose from. |
| `Asset file` | Asset, Asset link, Image, File, Drive link | Exact file name(s) or Drive link(s), comma-separated in carousel order. Overrides matching. |
| `Asset status` | Creative status | Your tracking only. |
| `Caption status` | Copy status | Set to **Approved** and the app will never edit that caption. |
| `Owner`, `Scheduled`, `Live` | Assignee; Published | Your tracking only. |
| `Compliance note` | Compliance, TGA | Shown as a warning before pushing. Never sent to Buffer. |

### Email tabs

| Column | Also accepted | Notes |
|---|---|---|
| ● `#` | | Email number. |
| ● `Date` | | Send date. |
| `Time` | | Send time. |
| ● `Subject line` | Subject, Email subject | |
| `Preview text` | Preview, Preheader | |
| `Hook` | Headline | Hero headline. |
| `Body copy` | Body, Email body, Caption | Draft copy. |
| `CTA`, `Asset brief`, `Asset group`, `Asset file`, `Owner`, `Compliance note` | | As above. |

## How the caption is assembled

The post text sent to Buffer is built in this order:

1. **Caption, word for word.** Approved copy is never rewritten.
2. **CTA** as its own paragraph, skipped if the caption already contains it. If the
   caption ends with a compliance line (e.g. "Always read the label and follow the
   directions for use."), the CTA goes *before* that line so compliance stays last.
3. **Hashtags** as the final paragraph.

Paragraphs are separated by blank lines. **Single line breaks inside a paragraph are
kept**, so price lists and quote stacks survive. In a spreadsheet cell, start a new
line with **Alt+Enter** (Option+Enter on a Mac).

## Posting times

When `Time` is blank, the app works out a time per client:

1. `Slot` = **AM** → 8:00
2. **Deadline wording** in the caption or Moment/Offer ("ends midnight", "last day",
   "last chance", "final hours", "closes tonight") → 20:30
3. `Slot` = **PM** → the pillar's evening time
4. Otherwise → the pillar's weekday or weekend time

The times per pillar are editable per client in **Settings → Posting times**. Times are
in the client's timezone and converted to UTC for Buffer.

## What gets flagged

Before anything is pushed, these stop a post (shown in red in the table):

- placeholders such as `[DROP IN REAL REVIEW]`, `{{name}}`, `TBC`
- an empty caption, a missing date, or no platform
- Instagram captions over 2,200 characters
- an Instagram post with no approved image
- two posts at the same time on the same channel
- a posting time in the past

Warnings (amber) don't block: compliance notes, and several images on a
non-carousel post.

## Importing

1. **Clients → the client → Calendar → Import calendar**, then choose the file.
2. Check the column matching, tick the tabs to import, confirm the month, click **Import**.
3. Fix anything flagged in the table (click a cell to edit it).
4. **Match imagery →**, then approve on the review board.

**Re-importing a month** updates rows by their `#`, keeps approved imagery and Buffer
post links, deletes rows you removed from the sheet (unless they're already in Buffer),
and adds new ones.
