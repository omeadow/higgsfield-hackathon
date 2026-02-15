const express = require("express");
const path = require("path");
const { getCreatorsWithEngagement, getCreatorByUsername, getPostsByCreator, getStats, getAllCampaignStatuses, updateCampaignStatus, getCampaignStats } = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use("/avatars", express.static(path.join(__dirname, "data", "avatars")));

app.get("/api/creators", (req, res) => {
  res.json(getCreatorsWithEngagement());
});

app.get("/api/creators/:username", (req, res) => {
  const creator = getCreatorByUsername(req.params.username);
  if (!creator) return res.status(404).json({ error: "Creator not found" });
  const posts = getPostsByCreator(req.params.username);
  res.json({ ...creator, posts });
});

app.get("/api/stats", (req, res) => {
  res.json(getStats());
});

app.get("/api/campaigns/stats", (req, res) => {
  res.json(getCampaignStats());
});

app.get("/api/campaigns", (req, res) => {
  res.json(getAllCampaignStatuses());
});

app.put("/api/campaigns/:username", (req, res) => {
  const { username } = req.params;
  const { status, notes } = req.body;
  const validStatuses = ['not_contacted', 'contacted', 'confirmed', 'content_posted'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: "Invalid status. Must be one of: " + validStatuses.join(', ') });
  }
  updateCampaignStatus(username, status, notes);
  res.json({ success: true, username, status, notes });
});

app.listen(PORT, () => {
  console.log(`Dashboard running at http://localhost:${PORT}`);
});
