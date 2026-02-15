require("dotenv").config();
const { ApifyClient } = require("apify-client");
const fs = require("fs");
const { upsertYtCreator, upsertYtVideo } = require("./db");
const { downloadYtAvatarsBatch } = require("./avatars");

const client = new ApifyClient({ token: process.env.APIFY_API_TOKEN });

const KEYWORDS = ["higgsfield", "higgsai", "aivideo", "aifilmmaking", "cinemastudio", "klingai", "seedance"];
const MAX_CHANNELS = 200;
const VIDEOS_PER_SEARCH = 100;
const BATCH_SIZE = 20;

// Apify actor names — adjust if these change on the marketplace
const SEARCH_ACTOR = "bernardo/youtube-scraper";
const CHANNEL_ACTOR = "streamers/youtube-channel-scraper";

async function searchYouTube() {
  const allVideos = [];

  for (const keyword of KEYWORDS) {
    console.log(`Searching YouTube for "${keyword}"...`);
    try {
      const run = await client.actor(SEARCH_ACTOR).call({
        searchKeywords: [keyword],
        maxResults: VIDEOS_PER_SEARCH,
        searchType: "video",
      });
      const dataset = await client.dataset(run.defaultDatasetId).listItems();
      console.log(`  "${keyword}": ${dataset.items.length} videos`);
      allVideos.push(...dataset.items);
    } catch (err) {
      console.warn(`  Failed to search "${keyword}": ${err.message}`);
    }
  }

  return allVideos;
}

function extractChannelUrls(videos) {
  const seen = new Set();
  const channels = [];

  for (const v of videos) {
    const channelUrl = v.channelUrl || v.channelLink;
    const channelId = v.channelId;
    const key = channelId || channelUrl;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    channels.push({ channelUrl, channelId, channelName: v.channelName });
  }

  return channels.slice(0, MAX_CHANNELS);
}

async function scrapeChannelsBatch(channelUrls) {
  try {
    const run = await client.actor(CHANNEL_ACTOR).call({
      channelUrls: channelUrls.map(u => ({ url: u })),
      maxVideos: 30,
    });
    const dataset = await client.dataset(run.defaultDatasetId).listItems();
    return dataset.items;
  } catch (err) {
    console.warn(`  Channel batch failed: ${err.message}`);
    return [];
  }
}

async function main() {
  console.log(`YouTube scraping: ${KEYWORDS.length} keywords, up to ${MAX_CHANNELS} channels`);
  console.log(`Keywords: ${KEYWORDS.join(", ")}\n`);

  // Phase 1: Search for videos to discover channels
  const allVideos = await searchYouTube();
  console.log(`\nTotal videos found: ${allVideos.length}`);

  // Save raw search results
  fs.writeFileSync("data/yt_search_results.json", JSON.stringify(allVideos, null, 2));

  // Phase 2: Extract unique channels
  const channels = extractChannelUrls(allVideos);
  console.log(`Unique channels to scrape: ${channels.length}\n`);

  // Phase 3: Batch channel scraping
  const allProfiles = [];
  const channelUrls = channels.map(c => c.channelUrl).filter(Boolean);
  const totalBatches = Math.ceil(channelUrls.length / BATCH_SIZE);

  for (let i = 0; i < channelUrls.length; i += BATCH_SIZE) {
    const batch = channelUrls.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    console.log(`Batch ${batchNum}/${totalBatches} - scraping ${batch.length} channels...`);

    const profiles = await scrapeChannelsBatch(batch);
    console.log(`  Got ${profiles.length} channel profiles`);

    // Persist to DB incrementally
    for (const profile of profiles) {
      upsertYtCreator(profile);
      const videos = profile.latestVideos || profile.videos || profile.recentVideos || [];
      const channelId = profile.channelId || profile.id;
      for (const video of videos) {
        upsertYtVideo(video, channelId);
      }
    }

    // Download thumbnails
    await downloadYtAvatarsBatch(profiles);

    allProfiles.push(...profiles);
    console.log(`  Progress: ${allProfiles.length}/${channels.length} channels saved\n`);
  }

  // Save combined JSON
  fs.writeFileSync("data/yt_channel_profiles.json", JSON.stringify(allProfiles, null, 2));

  // Summary
  console.log("=== YOUTUBE SCRAPING DONE ===");
  console.log(`Total channels scraped: ${allProfiles.length}`);
  console.log(`Total videos in search: ${allVideos.length}`);
  console.log("\nTop 10 YouTube channels by subscribers:");
  allProfiles
    .sort((a, b) => (b.subscriberCount ?? b.subscribers ?? 0) - (a.subscriberCount ?? a.subscribers ?? 0))
    .slice(0, 10)
    .forEach(c => {
      const subs = c.subscriberCount ?? c.subscribers ?? 0;
      const name = c.channelName || c.name || c.handle || "Unknown";
      console.log(`  ${name} - ${subs.toLocaleString()} subscribers`);
    });
}

module.exports = { main };

if (require.main === module) {
  main().catch(console.error);
}
