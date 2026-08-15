import "dotenv/config";
import express from "express";
import cors from "cors";
import analyzeRouter from "./routes/analyze";
import proxyRouter from "./routes/proxy";
import aiChatRouter from "./routes/aiChat";
import generateRouter from "./routes/generate";

const app = express();
const PORT = 4000;
const VERSION = "1.0.0";

app.use(cors());
app.use(express.json({ limit: "10mb" }));

app.use("/api/analyze", analyzeRouter);
app.use("/api/proxy", proxyRouter);
app.use("/api/ai-chat", aiChatRouter);
app.use("/api/generate", generateRouter);

// The desktop app decides whether to adopt a server already on this port or to
// warn that something else has it. "something answered" is not enough to make
// that call, so the answer says which program is answering.
app.get("/health", (req, res) => {
  res.json({
    status: "running",
    app: "reqflow",
    version: VERSION,
    timestamp: new Date().toISOString(),
  });
});

app.listen(PORT, () => {
  console.log(`reqflow backend running on http://localhost:${PORT}`);
});