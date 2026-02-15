require("dotenv").config();
const { ApifyClient } = require("apify-client");
const fs = require("fs");

const client = new ApifyClient({ token: process.env.APIFY_API_TOKEN });

async function scrapeHashtag() {
  console.log("Starting hashtag scrape for #higgsfield...");

  // Step 1: Scrape posts from the #higgsfield hashtag
  const hashtagRun = await client.actor("apify/instagram-hashtag-scraper").call({
    hashtags: ["higgsfield"],
    resultsLimit: 200,
  });

  const hashtagDataset = await client
    .dataset(hashtagRun.defaultDatasetId)
    .listItems();
  const posts = hashtagDataset.items;

  console.log(`Found ${posts.length} posts with #higgsfield`);

  // Step 2: Extract unique profile usernames from the posts
  const usernames = [...new Set(posts.map((p) => p.ownerUsername).filter(Boolean))];
  console.log(`Found ${usernames.length} unique creators`);

  // Save the raw posts
  fs.writeFileSync(
    "data/hashtag_posts.json",
    JSON.stringify(posts, null, 2)
  );

  // Step 3: Scrape full profile data for each creator
  console.log("Scraping creator profiles...");

  const profileRun = await client.actor("apify/instagram-profile-scraper").call({
    usernames,
    resultsLimit: 1,
  });

  const profileDataset = await client
    .dataset(profileRun.defaultDatasetId)
    .listItems();
  const profiles = profileDataset.items;

  console.log(`Scraped ${profiles.length} creator profiles`);

  // Save profiles
  fs.writeFileSync(
    "data/creator_profiles.json",
    JSON.stringify(profiles, null, 2)
  );

  // Step 4: Build a summary
  const summary = profiles.map((p) => ({
    username: p.username,
    fullName: p.fullName,
    biography: p.biography,
    followers: p.followersCount,
    following: p.followsCount,
    posts: p.postsCount,
    isVerified: p.verified,
    profileUrl: `https://www.instagram.com/${p.username}/`,
  }));

  fs.writeFileSync(
    "data/creator_summary.json",
    JSON.stringify(summary, null, 2)
  );

  console.log("Done! Results saved to data/");
  console.log("\nTop creators by followers:");
  summary
    .sort((a, b) => (b.followers || 0) - (a.followers || 0))
    .slice(0, 10)
    .forEach((c) => {
      console.log(`  @${c.username} - ${c.followers?.toLocaleString() ?? "?"} followers`);
    });
}

scrapeHashtag().catch(console.error);
