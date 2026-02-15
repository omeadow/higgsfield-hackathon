const Database = require("better-sqlite3");
const path = require("path");

const DB_PATH = path.join(__dirname, "data", "instascraper.db");
const db = new Database(DB_PATH);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS creators (
    username TEXT PRIMARY KEY,
    id TEXT,
    full_name TEXT,
    biography TEXT,
    followers INTEGER DEFAULT 0,
    following INTEGER DEFAULT 0,
    posts_count INTEGER DEFAULT 0,
    is_verified INTEGER DEFAULT 0,
    is_business INTEGER DEFAULT 0,
    business_category TEXT,
    private INTEGER DEFAULT 0,
    profile_pic_url TEXT,
    profile_pic_url_hd TEXT,
    external_urls TEXT DEFAULT '[]',
    scraped_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY,
    creator_username TEXT NOT NULL,
    type TEXT,
    short_code TEXT,
    caption TEXT,
    hashtags TEXT DEFAULT '[]',
    url TEXT,
    likes_count INTEGER DEFAULT 0,
    comments_count INTEGER DEFAULT 0,
    timestamp TEXT,
    display_url TEXT,
    FOREIGN KEY (creator_username) REFERENCES creators(username)
  );

  CREATE TABLE IF NOT EXISTS campaigns (
    username TEXT PRIMARY KEY REFERENCES creators(username),
    status TEXT DEFAULT 'not_contacted',
    notes TEXT DEFAULT '',
    updated_at TEXT DEFAULT (datetime('now'))
  );
`);

const upsertCreatorStmt = db.prepare(`
  INSERT INTO creators (username, id, full_name, biography, followers, following, posts_count,
    is_verified, is_business, business_category, private, profile_pic_url, profile_pic_url_hd,
    external_urls, scraped_at)
  VALUES (@username, @id, @full_name, @biography, @followers, @following, @posts_count,
    @is_verified, @is_business, @business_category, @private, @profile_pic_url, @profile_pic_url_hd,
    @external_urls, datetime('now'))
  ON CONFLICT(username) DO UPDATE SET
    id=@id, full_name=@full_name, biography=@biography, followers=@followers,
    following=@following, posts_count=@posts_count, is_verified=@is_verified,
    is_business=@is_business, business_category=@business_category, private=@private,
    profile_pic_url=@profile_pic_url, profile_pic_url_hd=@profile_pic_url_hd,
    external_urls=@external_urls, scraped_at=datetime('now')
`);

const upsertPostStmt = db.prepare(`
  INSERT INTO posts (id, creator_username, type, short_code, caption, hashtags, url,
    likes_count, comments_count, timestamp, display_url)
  VALUES (@id, @creator_username, @type, @short_code, @caption, @hashtags, @url,
    @likes_count, @comments_count, @timestamp, @display_url)
  ON CONFLICT(id) DO UPDATE SET
    caption=@caption, hashtags=@hashtags, likes_count=@likes_count,
    comments_count=@comments_count, display_url=@display_url
`);

function upsertCreator(profile) {
  upsertCreatorStmt.run({
    username: profile.username,
    id: profile.id || null,
    full_name: profile.fullName || null,
    biography: profile.biography || null,
    followers: profile.followersCount ?? 0,
    following: profile.followsCount ?? 0,
    posts_count: profile.postsCount ?? 0,
    is_verified: profile.verified ? 1 : 0,
    is_business: profile.isBusinessAccount ? 1 : 0,
    business_category: profile.businessCategoryName || null,
    private: profile.private ? 1 : 0,
    profile_pic_url: profile.profilePicUrl || null,
    profile_pic_url_hd: profile.profilePicUrlHD || null,
    external_urls: JSON.stringify(profile.externalUrls || []),
  });
}

function upsertPost(post, creatorUsername) {
  upsertPostStmt.run({
    id: post.id,
    creator_username: creatorUsername,
    type: post.type || null,
    short_code: post.shortCode || null,
    caption: post.caption || null,
    hashtags: JSON.stringify(post.hashtags || []),
    url: post.url || null,
    likes_count: post.likesCount ?? 0,
    comments_count: post.commentsCount ?? 0,
    timestamp: post.timestamp || null,
    display_url: post.displayUrl || null,
  });
}

function getAllCreators() {
  return db.prepare("SELECT * FROM creators ORDER BY followers DESC").all();
}

const NICHE_KEYWORDS = {
  'AI': ['ai', 'artificial intelligence', 'machine learning', 'ml', 'deep learning', 'gpt', 'neural'],
  'Video': ['video', 'film', 'filmmaker', 'cinema', 'vfx', 'animation', 'motion'],
  'Design': ['design', 'designer', 'graphic', 'ui', 'ux', 'illustration', 'illustrator'],
  'Fashion': ['fashion', 'style', 'stylist', 'model', 'outfit', 'clothing', 'beauty'],
  'Marketing': ['marketing', 'growth', 'brand', 'ads', 'social media', 'digital marketing'],
  'Creator': ['creator', 'content creator', 'influencer', 'creative'],
  'Photography': ['photo', 'photographer', 'photography', 'portrait', 'landscape'],
  'Music': ['music', 'musician', 'producer', 'dj', 'singer', 'songwriter'],
  'Tech': ['tech', 'developer', 'software', 'coding', 'programming', 'startup', 'saas'],
  'Fitness': ['fitness', 'gym', 'workout', 'health', 'nutrition', 'wellness', 'yoga'],
};

function extractNiches(biography) {
  if (!biography) return [];
  const bio = biography.toLowerCase();
  const niches = [];
  for (const [niche, keywords] of Object.entries(NICHE_KEYWORDS)) {
    if (keywords.some(kw => bio.includes(kw))) {
      niches.push(niche);
    }
  }
  return niches;
}

function getCreatorsWithEngagement() {
  const rows = db.prepare(`
    SELECT c.*,
      COALESCE(SUM(p.likes_count), 0) as total_likes,
      COALESCE(SUM(p.comments_count), 0) as total_comments,
      CASE WHEN c.followers > 0
        THEN ROUND((COALESCE(SUM(p.likes_count), 0) + COALESCE(SUM(p.comments_count), 0)) * 100.0 / c.followers, 2)
        ELSE 0 END as engagement_rate,
      CASE
        WHEN c.followers >= 200000 THEN 'macro'
        WHEN c.followers >= 50000 THEN 'mid-tier'
        WHEN c.followers >= 10000 THEN 'micro'
        ELSE 'nano'
      END as tier
    FROM creators c
    LEFT JOIN posts p ON c.username = p.creator_username
    GROUP BY c.username
    ORDER BY c.followers DESC
  `).all();
  return rows.map(row => ({ ...row, niches: extractNiches(row.biography) }));
}

function getCreatorByUsername(username) {
  return db.prepare("SELECT * FROM creators WHERE username = ?").get(username);
}

function getPostsByCreator(username) {
  return db
    .prepare("SELECT * FROM posts WHERE creator_username = ? ORDER BY timestamp DESC")
    .all(username);
}

function getStats() {
  return db
    .prepare(`
      SELECT
        COUNT(*) as total_creators,
        SUM(followers) as total_followers,
        ROUND(AVG(followers)) as avg_followers,
        MAX(followers) as max_followers,
        SUM(is_verified) as verified_count,
        SUM(posts_count) as total_posts
      FROM creators
    `)
    .get();
}

function getCampaignStatus(username) {
  return db.prepare("SELECT * FROM campaigns WHERE username = ?").get(username);
}

function updateCampaignStatus(username, status, notes) {
  db.prepare(`
    INSERT INTO campaigns (username, status, notes, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(username) DO UPDATE SET
      status = ?, notes = ?, updated_at = datetime('now')
  `).run(username, status, notes || '', status, notes || '');
}

function getAllCampaignStatuses() {
  return db.prepare(`
    SELECT cam.*, c.full_name, c.followers, c.profile_pic_url
    FROM campaigns cam
    JOIN creators c ON cam.username = c.username
    ORDER BY cam.updated_at DESC
  `).all();
}

function getCampaignStats() {
  return db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN status = 'not_contacted' THEN 1 ELSE 0 END), 0) as not_contacted,
      COALESCE(SUM(CASE WHEN status = 'contacted' THEN 1 ELSE 0 END), 0) as contacted,
      COALESCE(SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END), 0) as confirmed,
      COALESCE(SUM(CASE WHEN status = 'content_posted' THEN 1 ELSE 0 END), 0) as content_posted,
      COUNT(*) as total
    FROM campaigns
  `).get();
}

module.exports = {
  db,
  upsertCreator,
  upsertPost,
  getAllCreators,
  getCreatorsWithEngagement,
  getCreatorByUsername,
  getPostsByCreator,
  getStats,
  getCampaignStatus,
  updateCampaignStatus,
  getAllCampaignStatuses,
  getCampaignStats,
};
