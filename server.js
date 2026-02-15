const express = require("express");
const path = require("path");
const { getAllCreators, getCreatorByUsername, getPostsByCreator, getStats } = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));
app.use("/avatars", express.static(path.join(__dirname, "data", "avatars")));

app.get("/api/creators", (req, res) => {
  res.json(getAllCreators());
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

app.listen(PORT, () => {
  console.log(`Dashboard running at http://localhost:${PORT}`);
});
