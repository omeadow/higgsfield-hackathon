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

function getCreatorsWithEngagement() {
  return db.prepare(`
    SELECT c.*,
      COALESCE(SUM(p.likes_count), 0) as total_likes,
      COALESCE(SUM(p.comments_count), 0) as total_comments,
      CASE WHEN c.followers > 0
        THEN ROUND((COALESCE(SUM(p.likes_count), 0) + COALESCE(SUM(p.comments_count), 0)) * 100.0 / c.followers, 2)
        ELSE 0 END as engagement_rate
    FROM creators c
    LEFT JOIN posts p ON c.username = p.creator_username
    GROUP BY c.username
    ORDER BY c.followers DESC
  `).all();
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

module.exports = {
  db,
  upsertCreator,
  upsertPost,
  getAllCreators,
  getCreatorsWithEngagement,
  getCreatorByUsername,
  getPostsByCreator,
  getStats,
};
