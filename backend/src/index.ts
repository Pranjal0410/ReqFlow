import "dotenv/config";
import express from "express";
import cors from "cors";
import analyzeRouter from "./routes/analyze";
import proxyRouter from "./routes/proxy";
import aiChatRouter from "./routes/aiChat";
import generateRouter from "./routes/generate";

const app = express();
const PORT = 4000;

app.use(cors());
app.use(express.json({ limit: "10mb" }));

app.use("/api/analyze", analyzeRouter);
app.use("/api/proxy", proxyRouter);
app.use("/api/ai-chat", aiChatRouter);
app.use("/api/generate", generateRouter);

app.get("/health", (req, res) => {
  res.json({ status: "running", timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`reqflow backend running on http://localhost:${PORT}`);
});