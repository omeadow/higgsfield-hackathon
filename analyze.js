require("dotenv").config();
const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");
const {
  getCreatorsWithEngagement,
  getYtCreatorsWithEngagement,
  upsertAnalysisResult,
} = require("./db");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const CSV_PATH = path.join(__dirname, "Ideal_Creator_Profiles.csv");
const BATCH_SIZE = 10;

function parseCSV(csvText) {
  const lines = csvText.trim().split("\n");
  const headers = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const values = [];
    let current = "";
    let inQuotes = false;
    for (const ch of line) {
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === "," && !inQuotes) {
        values.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
    values.push(current.trim());
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = values[i] || "";
    });
    return obj;
  });
}

function getIdealProfiles() {
  const csv = fs.readFileSync(CSV_PATH, "utf-8");
  return parseCSV(csv);
}

function buildProfileDescriptions(profiles) {
  return profiles
    .map(
      (p, i) =>
        `${i + 1}. ${p.Profile}: ${p["Short Description (Audience • Niche • Platform)"]}. Examples: ${p["Example Creators"]}. Scale: ${p["Audience Scale"]}. Why: ${p["Why They Drive Subscription Revenue (Alignment)"]}`
    )
    .join("\n");
}

function prepareCreatorBatch(creators) {
  return creators.map((c) => {
    if (c.channel_id) {
      return {
        id: c.channel_id,
        name: c.channel_name || c.handle || "Unknown",
        platform: "youtube",
        bio: (c.description || "").slice(0, 300),
        followers: c.subscribers,
        engagement_rate: c.engagement_rate,
        niches: (c.niches || []).join(", "),
      };
    }
    return {
      id: c.username,
      name: c.full_name || c.username,
      platform: "instagram",
      bio: (c.biography || "").slice(0, 300),
      followers: c.followers,
      engagement_rate: c.engagement_rate,
      niches: (c.niches || []).join(", "),
    };
  });
}

async function analyzeBatch(batch, profileDescriptions, profileNames) {
  const prompt = `You are an influencer marketing analyst. Given 5 ideal creator profiles and a batch of scraped creator data, score each creator's fit (0-10) against each profile.

Ideal Profiles:
${profileDescriptions}

Creators to analyze:
${JSON.stringify(batch, null, 2)}

Return a JSON object with a "results" array. Each element must have:
- "creator_id": the creator's id
- "scores": an object with keys being the exact profile names and values being integers 0-10
- "best_fit": the profile name with the highest score
- "reasoning": 1-2 sentence explanation

Profile names to use as keys: ${JSON.stringify(profileNames)}`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    temperature: 0.3,
  });

  const content = response.choices[0].message.content;
  const parsed = JSON.parse(content);
  return parsed.results || parsed;
}

async function runAnalysis(onProgress) {
  const profiles = getIdealProfiles();
  const profileNames = profiles.map((p) => p.Profile);
  const profileDescriptions = buildProfileDescriptions(profiles);

  const igCreators = getCreatorsWithEngagement();
  const ytCreators = getYtCreatorsWithEngagement();
  const allCreators = [...igCreators, ...ytCreators];

  if (allCreators.length === 0) {
    return { success: true, analyzed_count: 0, duration_ms: 0 };
  }

  const startTime = Date.now();
  let analyzed = 0;
  const totalBatches = Math.ceil(allCreators.length / BATCH_SIZE);

  for (let i = 0; i < allCreators.length; i += BATCH_SIZE) {
    const batchCreators = allCreators.slice(i, i + BATCH_SIZE);
    const batch = prepareCreatorBatch(batchCreators);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;

    if (onProgress) {
      onProgress({ batch: batchNum, totalBatches, analyzed, total: allCreators.length });
    }

    const results = await analyzeBatch(batch, profileDescriptions, profileNames);

    for (const result of results) {
      const creator = batch.find((c) => c.id === result.creator_id);
      if (!creator) continue;

      const scores = result.scores || {};
      let bestProfile = result.best_fit || "";
      let bestScore = 0;

      for (const [profile, score] of Object.entries(scores)) {
        if (score > bestScore) {
          bestScore = score;
          bestProfile = profile;
        }
      }

      upsertAnalysisResult({
        id: `${creator.platform}:${creator.id}`,
        platform: creator.platform,
        creator_id: creator.id,
        creator_name: creator.name,
        profile_scores: scores,
        best_fit_profile: bestProfile,
        best_fit_score: bestScore,
        reasoning: result.reasoning || "",
      });

      analyzed++;
    }
  }

  return {
    success: true,
    analyzed_count: analyzed,
    duration_ms: Date.now() - startTime,
  };
}

module.exports = { runAnalysis, getIdealProfiles };
