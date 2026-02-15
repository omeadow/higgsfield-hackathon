const fs = require("fs");
const path = require("path");

const AVATARS_DIR = path.join(__dirname, "data", "avatars");
const YT_AVATARS_DIR = path.join(__dirname, "data", "yt_avatars");

if (!fs.existsSync(AVATARS_DIR)) {
  fs.mkdirSync(AVATARS_DIR, { recursive: true });
}
if (!fs.existsSync(YT_AVATARS_DIR)) {
  fs.mkdirSync(YT_AVATARS_DIR, { recursive: true });
}

async function downloadAvatar(username, url) {
  if (!url) return;
  const dest = path.join(AVATARS_DIR, `${username}.jpg`);
  if (fs.existsSync(dest)) return;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(dest, buffer);
    console.log(`  Downloaded avatar: ${username}`);
  } catch (err) {
    console.warn(`  Failed to download avatar for ${username}: ${err.message}`);
  }
}

async function downloadAvatarsBatch(profiles, concurrency = 10) {
  const queue = [...profiles];
  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length > 0) {
      const p = queue.shift();
      await downloadAvatar(p.username, p.profilePicUrl);
    }
  });
  await Promise.all(workers);
}

async function downloadYtAvatar(channelId, url) {
  if (!url) return;
  const dest = path.join(YT_AVATARS_DIR, `${channelId}.jpg`);
  if (fs.existsSync(dest)) return;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(dest, buffer);
    console.log(`  Downloaded YT avatar: ${channelId}`);
  } catch (err) {
    console.warn(`  Failed to download YT avatar for ${channelId}: ${err.message}`);
  }
}

async function downloadYtAvatarsBatch(channels, concurrency = 10) {
  const queue = [...channels];
  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length > 0) {
      const c = queue.shift();
      const id = c.channelId || c.id || c.channel_id;
      const url = c.thumbnailUrl || c.profilePicUrl || c.thumbnail_url;
      await downloadYtAvatar(id, url);
    }
  });
  await Promise.all(workers);
}

module.exports = { downloadAvatar, downloadAvatarsBatch, AVATARS_DIR, downloadYtAvatar, downloadYtAvatarsBatch, YT_AVATARS_DIR };
