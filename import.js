const fs = require("fs");
const path = require("path");
const { upsertCreator, upsertPost } = require("./db");
const { downloadAvatar } = require("./avatars");

const profilesPath = path.join(__dirname, "data", "creator_profiles.json");

if (!fs.existsSync(profilesPath)) {
  console.error("No creator_profiles.json found. Run scrape.js first.");
  process.exit(1);
}

async function run() {
  const profiles = JSON.parse(fs.readFileSync(profilesPath, "utf-8"));

  let creatorsImported = 0;
  let postsImported = 0;

  for (const profile of profiles) {
    upsertCreator(profile);
    creatorsImported++;

    if (profile.latestPosts) {
      for (const post of profile.latestPosts) {
        upsertPost(post, profile.username);
        postsImported++;
      }
    }
  }

  console.log(`Imported ${creatorsImported} creators and ${postsImported} posts into SQLite.`);

  console.log("Downloading avatars...");
  await Promise.all(
    profiles.map((p) => downloadAvatar(p.username, p.profilePicUrl))
  );
  console.log("Avatar download complete.");
}

run().catch(console.error);
