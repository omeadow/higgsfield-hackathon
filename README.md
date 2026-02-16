# Higgsfield Creator Dashboard

An influencer marketing tool that scrapes Instagram and YouTube creators, scores their fit against ideal creator profiles using AI, and displays everything in a unified web dashboard. Built for the Higgsfield marketing team to discover, evaluate, and manage creator partnerships.

## How It Works (Big Picture)

```
Scrape creators (IG + YT)  →  Store in SQLite  →  AI scores each creator  →  Dashboard shows results
       ↓                            ↓                      ↓                        ↓
  Apify actors             db.js (7 tables)         OpenAI GPT-4o-mini       Express + vanilla JS
```

1. **Scraping** — Apify actors discover creators via hashtags (Instagram) and search queries (YouTube)
2. **Storage** — All creator profiles, posts/videos, campaign statuses, and AI scores live in a single SQLite database
3. **AI Analysis** — Each creator is scored 0-10 against 5 ideal creator profiles defined in a CSV file
4. **Dashboard** — A single-page app shows creators from both platforms in a unified view with sorting, filtering, campaign tracking, and AI analytics

## File-by-File Walkthrough

Read the files in this order to understand the full system:

### 1. `Ideal_Creator_Profiles.csv`

**Start here.** This CSV defines the 5 ideal creator profiles that drive the entire analysis. Each row is a profile with:

- **Profile name** — e.g. "Workflow Tutorial Videomakers"
- **Short description** — audience, niche, and platform
- **Example creators** — real-world reference channels
- **Audience scale** — target subscriber/follower range (10K-150K)
- **Why they matter** — business reasoning for why this profile drives Higgsfield subscriptions

The 5 profiles are:
1. **Workflow Tutorial Videomakers** — editors showing "how I made this" on YouTube
2. **UGC / Ad Creative Agencies** — performance marketers making scalable ad content
3. **Creative Entrepreneurs / Course Creators** — personal brands selling digital products
4. **AI Tool Comparison Reviewers** — channels reviewing and comparing AI video tools
5. **Cinematic Breakdown Creators** — channels analyzing viral ads and film techniques

### 2. `db.js` — Database Layer

The central data store. Uses `better-sqlite3` with WAL mode for performance.

**7 tables:**

| Table | Purpose |
|-------|---------|
| `creators` | Instagram creator profiles (username, bio, followers, etc.) |
| `posts` | Instagram posts (likes, comments, captions, timestamps) |
| `campaigns` | Instagram outreach tracking (status per creator) |
| `yt_creators` | YouTube channel profiles (subscribers, views, description) |
| `yt_videos` | YouTube videos (views, likes, comments, duration) |
| `yt_campaigns` | YouTube outreach tracking (status per channel) |
| `analysis_results` | AI scoring results (scores per profile, best fit, reasoning) |

**Key patterns:**
- Every table uses upsert (INSERT ... ON CONFLICT DO UPDATE) so scrapers can run repeatedly without duplicates
- `getCreatorsWithEngagement()` and `getYtCreatorsWithEngagement()` are the main queries — they JOIN with posts/videos to compute engagement rates and assign tier labels
- YouTube creators are filtered to 10K-500K subscribers at the query level
- Niche detection (`extractNiches()`) scans bios for keywords like "ai", "video", "marketing" — used for both IG and YT creators
- Engagement rate formula: Instagram = `(likes + comments) / followers`, YouTube = `(likes + comments) / views`

### 3. `avatars.js` — Avatar Downloads

Downloads profile pictures for both platforms into `data/avatars/` (IG) and `data/yt_avatars/` (YT). Uses a concurrent worker pool (10 parallel downloads). Skips already-downloaded avatars.

### 4. `scrape.js` — Instagram Scraper

Discovers Instagram creators through:
1. **Hashtag scraping** — searches hashtags like #higgsfield, #aivideo, #aifilmmaking
2. **Keyword search** — searches "higgsfield" directly
3. **Profile scraping** — fetches full profiles in batches of 50

Uses Apify actors: `apify/instagram-hashtag-scraper` and `apify/instagram-profile-scraper`. Saves profiles and their latest posts to the DB. Also triggers YouTube scraping at the end (`yt_scrape.main()`).

Run: `npm run scrape`

### 5. `yt_scrape.js` — YouTube Scraper

Discovers YouTube channels through a two-phase approach:

**Phase 1: Search** — Sends 53 search queries to YouTube (via Apify's `streamers/youtube-channel-scraper` actor) to discover videos and their channels. Queries are aligned with the 5 ideal profiles, e.g. "video editing workflow tutorial", "best ai video tools comparison", "ugc creator workflow".

**Phase 2: Channel scraping** — Takes the unique channels discovered from search results, scrapes them in batches of 15 to get full profile data and recent videos. Only stores channels with 10K-500K subscribers.

The actor uses `startUrls` with YouTube search URLs (like `youtube.com/results?search_query=...`) for discovery, then channel URLs for profile scraping.

Run: `npm run scrape:yt`

### 6. `import.js` — Manual Data Import

A utility script that imports previously-scraped Instagram data from `data/creator_profiles.json` into the database. Useful if you have raw JSON from a prior scrape and want to reload the DB without re-scraping.

Run: `npm run import`

### 7. `analyze.js` — AI Analysis Engine

The core intelligence layer. Uses OpenAI GPT-4o-mini to score every creator against all 5 ideal profiles.

**How it works:**
1. Reads ideal profiles from `Ideal_Creator_Profiles.csv` (custom CSV parser handles quoted fields)
2. Loads all IG + YT creators from the database
3. Batches them into groups of 10
4. Sends each batch to GPT-4o-mini with a prompt that includes profile descriptions and creator data (bio, followers, engagement, niches)
5. GPT returns a JSON object with scores (0-10) for each profile, the best fit, and a reasoning sentence
6. Results are stored in `analysis_results` table

**Key decisions:**
- `gpt-4o-mini` for cost efficiency (analyzing 100+ creators)
- `temperature: 0.3` for consistent scoring
- `response_format: { type: "json_object" }` for reliable parsing
- Batches of 10 to stay within token limits

Exports: `runAnalysis()` (called by the API), `getIdealProfiles()` (serves the CSV data)

### 8. `server.js` — Express API Server

Serves the dashboard and all API endpoints. Key route groups:

**Instagram API:**
- `GET /api/creators` — all creators with engagement metrics
- `GET /api/creators/:username` — single creator with their posts
- `GET /api/stats` — aggregate stats
- `GET /api/campaigns` + `PUT /api/campaigns/:username` — campaign tracking

**YouTube API:**
- `GET /api/yt/creators` — all YT channels with engagement metrics
- `GET /api/yt/creators/:channelId` — single channel with videos
- `GET /api/yt/stats` — aggregate stats
- `GET /api/yt/campaigns` + `PUT /api/yt/campaigns/:channelId` — campaign tracking

**Analysis API:**
- `POST /api/analysis/run` — triggers AI analysis (mutex prevents concurrent runs)
- `GET /api/analysis/results` — scored results (optional `?platform=` filter)
- `GET /api/analysis/stats` — distribution by profile, average scores
- `GET /api/analysis/profiles` — the 5 ideal profiles from CSV
- `DELETE /api/analysis/results` — clear for re-run

**Static files:**
- `public/` — dashboard HTML/CSS/JS
- `/avatars/` — Instagram profile pictures
- `/yt-avatars/` — YouTube profile pictures
- `/diagram.jpg` — architecture diagram

### 9. `public/index.html` — Dashboard Frontend

A single-page app with no framework (vanilla JS + CSS). All rendering happens client-side.

**Tabs:**
1. **Creators** — unified grid of IG + YT creators with platform badges, engagement rates, tier labels, follower counts. Sortable and filterable by platform.
2. **Revenue Projections** — estimated campaign value calculations
3. **Campaign Tracker** — Kanban-style pipeline (Not Contacted → Contacted → Confirmed → Content Posted) for both platforms combined
4. **AI Analytics** — run analysis button, summary cards (distribution by profile, avg score), expandable results table with score bars, reasoning, engagement rates
5. **How Scoring Works** — non-technical explanation of the AI scoring process
6. **Diagram** — displays `diagram.jpg` (architecture/strategy visual)
7. **How Engagement Works** — explains IG and YT engagement rate formulas side by side

**Frontend normalization:**
Both IG and YT creators are normalized into a common shape (`_id`, `_name`, `_displayName`, `_avatarSrc`, `_profileUrl`, `_bio`, `_audience`, `_contentCount`, `_contentLabel`, `platform`) so the entire UI is platform-agnostic. Platform badges (IG/YT) identify the source.

## Setup

### Prerequisites
- Node.js
- An [Apify](https://apify.com) account (for scraping)
- An [OpenAI](https://platform.openai.com) API key (for AI analysis)

### Install and Run

```bash
npm install
```

Create a `.env` file:
```
APIFY_API_TOKEN=your_apify_token
OPENAI_API_KEY=your_openai_key
```

Start the dashboard:
```bash
npm start
# Opens at http://localhost:3000
```

### Scraping

```bash
# Scrape Instagram + YouTube (runs both)
npm run scrape

# Scrape YouTube only
npm run scrape:yt

# Import previously-scraped IG data from JSON
npm run import
```

### Data Files

All data lives in `data/`:
- `instascraper.db` — SQLite database (the source of truth)
- `avatars/` — downloaded IG profile pictures
- `yt_avatars/` — downloaded YT profile pictures
- `creator_profiles.json` — raw IG scrape results
- `yt_channel_profiles.json` — raw YT scrape results
- `yt_search_results.json` — raw YT search video results

## Dependencies

| Package | Purpose |
|---------|---------|
| `express` | Web server and API |
| `better-sqlite3` | SQLite database driver |
| `apify-client` | Apify actor API for scraping |
| `openai` | OpenAI API for AI analysis |
| `dotenv` | Environment variable loading |
