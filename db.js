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

  CREATE TABLE IF NOT EXISTS yt_creators (
    channel_id TEXT PRIMARY KEY,
    channel_name TEXT,
    handle TEXT,
    description TEXT,
    subscribers INTEGER DEFAULT 0,
    total_views INTEGER DEFAULT 0,
    video_count INTEGER DEFAULT 0,
    is_verified INTEGER DEFAULT 0,
    channel_url TEXT,
    thumbnail_url TEXT,
    country TEXT,
    joined_date TEXT,
    scraped_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS yt_videos (
    video_id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    title TEXT,
    description TEXT,
    url TEXT,
    views INTEGER DEFAULT 0,
    likes INTEGER DEFAULT 0,
    comments INTEGER DEFAULT 0,
    duration TEXT,
    published_at TEXT,
    thumbnail_url TEXT,
    FOREIGN KEY (channel_id) REFERENCES yt_creators(channel_id)
  );

  CREATE TABLE IF NOT EXISTS yt_campaigns (
    channel_id TEXT PRIMARY KEY REFERENCES yt_creators(channel_id),
    status TEXT DEFAULT 'not_contacted',
    notes TEXT DEFAULT '',
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS analysis_results (
    id TEXT PRIMARY KEY,
    platform TEXT NOT NULL,
    creator_id TEXT NOT NULL,
    creator_name TEXT,
    profile_scores TEXT,
    best_fit_profile TEXT,
    best_fit_score INTEGER,
    reasoning TEXT,
    analyzed_at TEXT DEFAULT (datetime('now'))
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

// ========== YOUTUBE ==========

const upsertYtCreatorStmt = db.prepare(`
  INSERT INTO yt_creators (channel_id, channel_name, handle, description, subscribers, total_views,
    video_count, is_verified, channel_url, thumbnail_url, country, joined_date, scraped_at)
  VALUES (@channel_id, @channel_name, @handle, @description, @subscribers, @total_views,
    @video_count, @is_verified, @channel_url, @thumbnail_url, @country, @joined_date, datetime('now'))
  ON CONFLICT(channel_id) DO UPDATE SET
    channel_name=@channel_name, handle=@handle, description=@description, subscribers=@subscribers,
    total_views=@total_views, video_count=@video_count, is_verified=@is_verified,
    channel_url=@channel_url, thumbnail_url=@thumbnail_url, country=@country,
    joined_date=@joined_date, scraped_at=datetime('now')
`);

const upsertYtVideoStmt = db.prepare(`
  INSERT INTO yt_videos (video_id, channel_id, title, description, url, views, likes, comments,
    duration, published_at, thumbnail_url)
  VALUES (@video_id, @channel_id, @title, @description, @url, @views, @likes, @comments,
    @duration, @published_at, @thumbnail_url)
  ON CONFLICT(video_id) DO UPDATE SET
    title=@title, description=@description, views=@views, likes=@likes,
    comments=@comments, thumbnail_url=@thumbnail_url
`);

function upsertYtCreator(channel) {
  upsertYtCreatorStmt.run({
    channel_id: channel.channelId || channel.id,
    channel_name: channel.channelName || channel.name || null,
    handle: channel.handle || channel.userName || null,
    description: channel.description || channel.channelDescription || null,
    subscribers: channel.subscriberCount ?? channel.subscribers ?? 0,
    total_views: channel.viewCount ?? channel.totalViews ?? 0,
    video_count: channel.videoCount ?? channel.videos ?? 0,
    is_verified: channel.isVerified ? 1 : 0,
    channel_url: channel.channelUrl || channel.url || null,
    thumbnail_url: channel.thumbnailUrl || channel.profilePicUrl || null,
    country: channel.country || null,
    joined_date: channel.joinedDate || null,
  });
}

function upsertYtVideo(video, channelId) {
  upsertYtVideoStmt.run({
    video_id: video.videoId || video.id,
    channel_id: channelId,
    title: video.title || null,
    description: video.description || null,
    url: video.url || null,
    views: video.viewCount ?? video.views ?? 0,
    likes: video.likeCount ?? video.likes ?? 0,
    comments: video.commentCount ?? video.comments ?? 0,
    duration: video.duration || null,
    published_at: video.publishedAt || video.date || null,
    thumbnail_url: video.thumbnailUrl || null,
  });
}

function getYtCreatorsWithEngagement() {
  const rows = db.prepare(`
    SELECT c.*,
      COALESCE(AVG(v.views), 0) as avg_views,
      COALESCE(AVG(v.likes), 0) as avg_likes,
      COALESCE(AVG(v.comments), 0) as avg_comments,
      CASE WHEN COALESCE(AVG(v.views), 0) > 0
        THEN ROUND((COALESCE(AVG(v.likes), 0) + COALESCE(AVG(v.comments), 0)) * 100.0 / AVG(v.views), 2)
        ELSE 0 END as engagement_rate,
      CASE
        WHEN c.subscribers >= 1000000 THEN 'macro'
        WHEN c.subscribers >= 100000 THEN 'mid-tier'
        WHEN c.subscribers >= 10000 THEN 'micro'
        ELSE 'nano'
      END as tier
    FROM yt_creators c
    LEFT JOIN yt_videos v ON c.channel_id = v.channel_id
    GROUP BY c.channel_id
    ORDER BY c.subscribers DESC
  `).all();
  return rows.map(row => ({ ...row, niches: extractNiches(row.description) }));
}

function getYtCreatorByChannelId(channelId) {
  return db.prepare("SELECT * FROM yt_creators WHERE channel_id = ?").get(channelId);
}

function getVideosByChannel(channelId) {
  return db.prepare("SELECT * FROM yt_videos WHERE channel_id = ? ORDER BY published_at DESC").all(channelId);
}

function getYtStats() {
  return db.prepare(`
    SELECT
      COUNT(*) as total_channels,
      COALESCE(SUM(subscribers), 0) as total_subscribers,
      ROUND(AVG(subscribers)) as avg_subscribers,
      MAX(subscribers) as max_subscribers,
      SUM(is_verified) as verified_count,
      COALESCE(SUM(video_count), 0) as total_videos
    FROM yt_creators
  `).get();
}

function getYtCampaignStatus(channelId) {
  return db.prepare("SELECT * FROM yt_campaigns WHERE channel_id = ?").get(channelId);
}

function updateYtCampaignStatus(channelId, status, notes) {
  db.prepare(`
    INSERT INTO yt_campaigns (channel_id, status, notes, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(channel_id) DO UPDATE SET
      status = ?, notes = ?, updated_at = datetime('now')
  `).run(channelId, status, notes || '', status, notes || '');
}

function getAllYtCampaignStatuses() {
  return db.prepare(`
    SELECT cam.*, c.channel_name, c.subscribers, c.thumbnail_url
    FROM yt_campaigns cam
    JOIN yt_creators c ON cam.channel_id = c.channel_id
    ORDER BY cam.updated_at DESC
  `).all();
}

// ========== ANALYSIS ==========

const upsertAnalysisResultStmt = db.prepare(`
  INSERT INTO analysis_results (id, platform, creator_id, creator_name, profile_scores, best_fit_profile, best_fit_score, reasoning, analyzed_at)
  VALUES (@id, @platform, @creator_id, @creator_name, @profile_scores, @best_fit_profile, @best_fit_score, @reasoning, datetime('now'))
  ON CONFLICT(id) DO UPDATE SET
    creator_name=@creator_name, profile_scores=@profile_scores, best_fit_profile=@best_fit_profile,
    best_fit_score=@best_fit_score, reasoning=@reasoning, analyzed_at=datetime('now')
`);

function upsertAnalysisResult(result) {
  upsertAnalysisResultStmt.run({
    id: result.id,
    platform: result.platform,
    creator_id: result.creator_id,
    creator_name: result.creator_name || null,
    profile_scores: typeof result.profile_scores === 'string' ? result.profile_scores : JSON.stringify(result.profile_scores),
    best_fit_profile: result.best_fit_profile,
    best_fit_score: result.best_fit_score,
    reasoning: result.reasoning || null,
  });
}

function getAllAnalysisResults() {
  return db.prepare("SELECT * FROM analysis_results ORDER BY best_fit_score DESC").all();
}

function getAnalysisResultsByPlatform(platform) {
  return db.prepare("SELECT * FROM analysis_results WHERE platform = ? ORDER BY best_fit_score DESC").all(platform);
}

function getAnalysisStats() {
  const rows = db.prepare(`
    SELECT best_fit_profile, COUNT(*) as count, ROUND(AVG(best_fit_score), 1) as avg_score
    FROM analysis_results
    GROUP BY best_fit_profile
    ORDER BY count DESC
  `).all();
  const total = db.prepare("SELECT COUNT(*) as total, ROUND(AVG(best_fit_score), 1) as avg_score FROM analysis_results").get();
  return { by_profile: rows, total: total.total, avg_score: total.avg_score };
}

function clearAnalysisResults() {
  db.prepare("DELETE FROM analysis_results").run();
}

function getYtCampaignStats() {
  return db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN status = 'not_contacted' THEN 1 ELSE 0 END), 0) as not_contacted,
      COALESCE(SUM(CASE WHEN status = 'contacted' THEN 1 ELSE 0 END), 0) as contacted,
      COALESCE(SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END), 0) as confirmed,
      COALESCE(SUM(CASE WHEN status = 'content_posted' THEN 1 ELSE 0 END), 0) as content_posted,
      COUNT(*) as total
    FROM yt_campaigns
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
  // YouTube
  upsertYtCreator,
  upsertYtVideo,
  getYtCreatorsWithEngagement,
  getYtCreatorByChannelId,
  getVideosByChannel,
  getYtStats,
  getYtCampaignStatus,
  updateYtCampaignStatus,
  getAllYtCampaignStatuses,
  getYtCampaignStats,
  // Analysis
  upsertAnalysisResult,
  getAllAnalysisResults,
  getAnalysisResultsByPlatform,
  getAnalysisStats,
  clearAnalysisResults,
};
