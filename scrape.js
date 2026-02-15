require("dotenv").config();
const { ApifyClient } = require("apify-client");
const fs = require("fs");
const { upsertCreator, upsertPost } = require("./db");
const { downloadAvatarsBatch } = require("./avatars");

const client = new ApifyClient({ token: process.env.APIFY_API_TOKEN });

const HASHTAGS = ["higgsfield", "higgsai", "aivideo", "aifilmmaking", "cinemastudio", "klingai", "seedance"];
const KEYWORD = "higgsfield";
const TARGET_PROFILES = 500;
const POSTS_PER_HASHTAG = 1000;
const BATCH_SIZE = 50;

async function scrapeHashtags() {
  const allPosts = [];

  for (const tag of HASHTAGS) {
    console.log(`Scraping hashtag #${tag}...`);
    try {
      const run = await client.actor("apify/instagram-hashtag-scraper").call({
        hashtags: [tag],
        resultsLimit: POSTS_PER_HASHTAG,
      });
      const dataset = await client.dataset(run.defaultDatasetId).listItems();
      console.log(`  #${tag}: ${dataset.items.length} posts`);
      allPosts.push(...dataset.items);
    } catch (err) {
      console.warn(`  Failed to scrape #${tag}: ${err.message}`);
    }
  }

  return allPosts;
}

async function searchKeyword() {
  console.log(`Searching keyword "${KEYWORD}"...`);
  try {
    const run = await client.actor("apify/instagram-scraper").call({
      search: KEYWORD,
      searchType: "hashtag",
      resultsLimit: POSTS_PER_HASHTAG,
    });
    const dataset = await client.dataset(run.defaultDatasetId).listItems();
    console.log(`  Keyword search: ${dataset.items.length} results`);
    return dataset.items;
  } catch (err) {
    console.warn(`  Keyword search failed: ${err.message}`);
    return [];
  }
}

async function scrapeProfilesBatch(usernames) {
  try {
    const run = await client.actor("apify/instagram-profile-scraper").call({
      usernames,
      resultsLimit: 1,
    });
    const dataset = await client.dataset(run.defaultDatasetId).listItems();
    return dataset.items;
  } catch (err) {
    console.warn(`  Batch failed: ${err.message}`);
    return [];
  }
}

async function main() {
  console.log(`Target: ${TARGET_PROFILES} creator profiles`);
  console.log(`Hashtags: ${HASHTAGS.map(h => "#" + h).join(", ")}`);
  console.log("");

  // Step 1: Collect posts from hashtags + keyword search
  const hashtagPosts = await scrapeHashtags();
  const keywordPosts = await searchKeyword();
  const allPosts = [...hashtagPosts, ...keywordPosts];

  console.log(`\nTotal posts collected: ${allPosts.length}`);

  // Save raw posts
  fs.writeFileSync("data/hashtag_posts.json", JSON.stringify(allPosts, null, 2));

  // Step 2: Deduplicate usernames
  const allUsernames = [...new Set(allPosts.map((p) => p.ownerUsername).filter(Boolean))];
  const usernames = allUsernames.slice(0, TARGET_PROFILES);
  console.log(`Unique creators found: ${allUsernames.length}`);
  console.log(`Will scrape: ${usernames.length} profiles\n`);

  // Step 3: Batch profile scraping
  const allProfiles = [];
  const totalBatches = Math.ceil(usernames.length / BATCH_SIZE);

  for (let i = 0; i < usernames.length; i += BATCH_SIZE) {
    const batch = usernames.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    console.log(`Batch ${batchNum}/${totalBatches} — scraping ${batch.length} profiles...`);

    const profiles = await scrapeProfilesBatch(batch);
    console.log(`  Got ${profiles.length} profiles`);

    // Persist incrementally to DB
    for (const profile of profiles) {
      upsertCreator(profile);
      if (profile.latestPosts) {
        for (const post of profile.latestPosts) {
          upsertPost(post, profile.username);
        }
      }
    }

    // Download avatars for this batch
    await downloadAvatarsBatch(profiles);

    allProfiles.push(...profiles);
    console.log(`  Progress: ${allProfiles.length}/${usernames.length} profiles saved\n`);
  }

  // Step 4: Save combined JSON files
  fs.writeFileSync("data/creator_profiles.json", JSON.stringify(allProfiles, null, 2));

  const summary = allProfiles.map((p) => ({
    username: p.username,
    fullName: p.fullName,
    biography: p.biography,
    followers: p.followersCount,
    following: p.followsCount,
    posts: p.postsCount,
    isVerified: p.verified,
    profileUrl: `https://www.instagram.com/${p.username}/`,
  }));

  fs.writeFileSync("data/creator_summary.json", JSON.stringify(summary, null, 2));

  // Step 5: Summary
  console.log("=== DONE ===");
  console.log(`Total profiles scraped: ${allProfiles.length}`);
  console.log(`Total posts collected: ${allPosts.length}`);
  console.log("\nTop 10 creators by followers:");
  summary
    .sort((a, b) => (b.followers || 0) - (a.followers || 0))
    .slice(0, 10)
    .forEach((c) => {
      console.log(`  @${c.username} - ${c.followers?.toLocaleString() ?? "?"} followers`);
    });
}

main().catch(console.error);
