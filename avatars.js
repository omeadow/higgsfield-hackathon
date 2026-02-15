const fs = require("fs");
const path = require("path");

const AVATARS_DIR = path.join(__dirname, "data", "avatars");

if (!fs.existsSync(AVATARS_DIR)) {
  fs.mkdirSync(AVATARS_DIR, { recursive: true });
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

module.exports = { downloadAvatar, AVATARS_DIR };
