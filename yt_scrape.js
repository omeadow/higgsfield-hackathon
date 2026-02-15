require("dotenv").config();
const { ApifyClient } = require("apify-client");
const fs = require("fs");
const { upsertYtCreator, upsertYtVideo } = require("./db");
const { downloadYtAvatarsBatch } = require("./avatars");

const client = new ApifyClient({ token: process.env.APIFY_API_TOKEN });

// Single actor handles both search and channel scraping
const ACTOR_ID = "streamers/youtube-channel-scraper";

// Search queries aligned with ideal creator profiles
const SEARCH_QUERIES = [
  // Workflow Tutorial Videomakers
  "video editing workflow tutorial",
  "how I edit my videos premiere pro",
  "after effects workflow tutorial",
  "davinci resolve editing workflow",
  "my video editing process",
  "how to edit youtube videos faster",
  "color grading workflow tutorial",
  // UGC / Ad Creative
  "UGC ad creative tools",
  "ai ugc video maker",
  "how to make ugc ads",
  "ugc creator workflow",
  "performance creative video ads",
  "tiktok ad creative process",
  // AI video tools & generation
  "ai video generation tools 2025",
  "best ai video tools comparison",
  "ai filmmaking tools review",
  "kling ai video tutorial",
  "ai video editing software",
  "runway ml tutorial",
  "pika ai video",
  "sora ai video examples",
  "ai b-roll generator",
  "ai video for marketing",
  "ai tools for content creators 2025",
  "ai video production workflow",
  // AI tool comparison / reviews
  "best ai tools for video creators",
  "ai video editor comparison",
  "top ai tools for youtubers",
  "ai tools review for filmmakers",
  "ai image to video tools ranked",
  // Cinematic breakdowns
  "cinematic video breakdown tutorial",
  "recreating viral ads breakdown",
  "how this ad was made breakdown",
  "commercial filmmaking breakdown",
  "film technique analysis youtube",
  "viral video editing techniques",
  "recreating famous movie shots",
  // Creator tools & business
  "content creator video tools",
  "course creator video production",
  "youtube automation tools",
  "creator economy tools 2025",
  "how to sell digital products video",
  "online course video production",
  // Short-form video creation
  "how to make reels for business",
  "short form video editing tips",
  "vertical video editing workflow",
  // Motion graphics / VFX
  "motion graphics tutorial beginner",
  "vfx breakdown youtube",
  "after effects templates tutorial",
  // Direct brand mentions
  "higgsfield ai",
  "higgsfield ai video",
  "seedance ai video",
  "cinema studio ai",
];

const RESULTS_PER_QUERY = 20;
const MIN_SUBSCRIBERS = 10000;
const MAX_SUBSCRIBERS = 500000;
const MAX_CHANNELS = 300;
const CHANNEL_BATCH_SIZE = 15;

async function searchForVideos() {
  const allVideos = [];
  const searchUrls = SEARCH_QUERIES.map(q => ({
    url: `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`,
  }));

  // Run all search queries in one actor call
  console.log(`Searching YouTube with ${SEARCH_QUERIES.length} queries...`);
  try {
    const run = await client.actor(ACTOR_ID).call({
      startUrls: searchUrls,
      maxResults: RESULTS_PER_QUERY,
      maxResultsShorts: 0,
      maxResultStreams: 0,
    }, { timeout: 300 });

    const dataset = await client.dataset(run.defaultDatasetId).listItems();
    console.log(`  Found ${dataset.items.length} videos from search`);
    allVideos.push(...dataset.items);
  } catch (err) {
    console.error(`  Search failed: ${err.message}`);
  }

  return allVideos;
}

function extractUniqueChannels(videos) {
  const seen = new Set();
  const channels = [];

  for (const v of videos) {
    const channelUrl = v.channelUrl;
    const channelId = v.channelId;
    const key = channelId || channelUrl;
    if (!key || seen.has(key)) continue;
    seen.add(key);

    // Build a proper channel URL
    let url = channelUrl;
    if (!url && v.channelUsername) {
      url = `https://www.youtube.com/@${v.channelUsername}`;
    }
    if (!url && channelId) {
      url = `https://www.youtube.com/channel/${channelId}`;
    }
    if (!url) continue;

    channels.push({
      channelUrl: url,
      channelId,
      channelName: v.channelName,
    });
  }

  return channels.slice(0, MAX_CHANNELS);
}

function normalizeChannelData(item) {
  return {
    channelId: item.channelId || item.id,
    channelName: item.aboutChannelInfo?.channelName || item.channelName || item.title,
    handle: item.channelUsername || item.aboutChannelInfo?.channelHandle,
    description: item.channelDescription || item.aboutChannelInfo?.channelDescription || item.description || "",
    subscriberCount: item.numberOfSubscribers || item.subscriberCount || 0,
    viewCount: item.channelTotalViews || item.viewCount || 0,
    videoCount: item.channelTotalVideos || item.videoCount || 0,
    isVerified: item.isChannelVerified || false,
    channelUrl: item.inputChannelUrl || item.channelUrl || item.url,
    thumbnailUrl: item.channelAvatarUrl || item.thumbnailUrl,
    country: item.channelLocation || item.aboutChannelInfo?.channelLocation || "",
    joinedDate: item.channelJoinedDate || item.aboutChannelInfo?.channelJoinedDate || "",
  };
}

function normalizeVideoData(item) {
  return {
    videoId: item.id,
    title: item.title,
    description: item.description || "",
    url: item.url,
    viewCount: item.viewCount || 0,
    likeCount: item.likeCount || item.likes || 0,
    commentCount: item.commentCount || item.commentsCount || 0,
    duration: item.duration,
    publishedAt: item.date || item.publishedAt,
    thumbnailUrl: item.thumbnailUrl,
  };
}

async function scrapeChannelsBatch(channelUrls) {
  try {
    const run = await client.actor(ACTOR_ID).call({
      startUrls: channelUrls.map(u => ({ url: u })),
      maxResults: 20,
      maxResultsShorts: 0,
      maxResultStreams: 0,
    }, { timeout: 300 });

    const dataset = await client.dataset(run.defaultDatasetId).listItems();
    return dataset.items;
  } catch (err) {
    console.warn(`  Channel batch failed: ${err.message}`);
    return [];
  }
}

async function main() {
  console.log("=== YOUTUBE SCRAPER ===");
  console.log(`Queries: ${SEARCH_QUERIES.length}`);
  console.log(`Subscriber filter: ${MIN_SUBSCRIBERS/1000}K - ${MAX_SUBSCRIBERS/1000}K`);
  console.log(`Max channels: ${MAX_CHANNELS}\n`);

  // Phase 1: Search for videos to discover channels
  const allVideos = await searchForVideos();
  console.log(`\nTotal videos found: ${allVideos.length}`);

  // Save raw search results
  fs.writeFileSync("data/yt_search_results.json", JSON.stringify(allVideos, null, 2));

  // Phase 2: Extract unique channels
  const channels = extractUniqueChannels(allVideos);
  console.log(`Unique channels to scrape: ${channels.length}\n`);

  if (channels.length === 0) {
    console.log("No channels found. Check search queries or API limits.");
    return;
  }

  // Phase 3: Scrape each channel for full profile + videos
  const allProfiles = [];
  const channelUrls = channels.map(c => c.channelUrl).filter(Boolean);
  const totalBatches = Math.ceil(channelUrls.length / CHANNEL_BATCH_SIZE);

  for (let i = 0; i < channelUrls.length; i += CHANNEL_BATCH_SIZE) {
    const batch = channelUrls.slice(i, i + CHANNEL_BATCH_SIZE);
    const batchNum = Math.floor(i / CHANNEL_BATCH_SIZE) + 1;
    console.log(`Batch ${batchNum}/${totalBatches} - scraping ${batch.length} channels...`);

    const items = await scrapeChannelsBatch(batch);

    // Group items by channel — actor returns one item per video
    const channelMap = {};
    for (const item of items) {
      const chId = item.channelId;
      if (!chId) continue;
      if (!channelMap[chId]) {
        channelMap[chId] = { profile: normalizeChannelData(item), videos: [] };
      }
      // Each item is a video result, collect them
      if (item.id && item.title) {
        channelMap[chId].videos.push(normalizeVideoData(item));
      }
    }

    // Persist to DB — only channels in target subscriber range
    let skippedCount = 0;
    for (const [chId, data] of Object.entries(channelMap)) {
      const subs = data.profile.subscriberCount || 0;
      if (subs < MIN_SUBSCRIBERS || subs > MAX_SUBSCRIBERS) {
        skippedCount++;
        continue;
      }
      upsertYtCreator(data.profile);
      for (const video of data.videos) {
        upsertYtVideo(video, chId);
      }
    }
    if (skippedCount > 0) {
      console.log(`  Skipped ${skippedCount} channels outside ${MIN_SUBSCRIBERS/1000}K-${MAX_SUBSCRIBERS/1000}K range`);
    }

    // Download avatars
    const avatarData = Object.values(channelMap).map(d => ({
      channelId: d.profile.channelId,
      thumbnailUrl: d.profile.thumbnailUrl,
    }));
    await downloadYtAvatarsBatch(avatarData);

    const newCount = Object.keys(channelMap).length;
    allProfiles.push(...Object.values(channelMap).map(d => d.profile));
    console.log(`  Got ${newCount} channels, ${items.length} items. Progress: ${allProfiles.length} total\n`);
  }

  // Save combined JSON
  fs.writeFileSync("data/yt_channel_profiles.json", JSON.stringify(allProfiles, null, 2));

  // Summary
  console.log("=== YOUTUBE SCRAPING DONE ===");
  console.log(`Total channels scraped: ${allProfiles.length}`);
  console.log(`Total videos in search: ${allVideos.length}`);
  console.log("\nTop 10 channels by subscribers:");
  allProfiles
    .sort((a, b) => (b.subscriberCount || 0) - (a.subscriberCount || 0))
    .slice(0, 10)
    .forEach(c => {
      console.log(`  ${c.channelName || "Unknown"} - ${(c.subscriberCount || 0).toLocaleString()} subscribers`);
    });
}

module.exports = { main };

if (require.main === module) {
  main().catch(console.error);
}
