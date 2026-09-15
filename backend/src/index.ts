import "dotenv/config";
import { loadSettingsFile } from "./services/settings";

// After dotenv, and deliberately over it: whatever the user last chose in
// Settings outranks both the file next to the source and the environment the
// wrapper started this process with.
loadSettingsFile();
import express from "express";
import cors from "cors";
import analyzeRouter from "./routes/analyze";
import proxyRouter from "./routes/proxy";
import aiChatRouter from "./routes/aiChat";
import generateRouter from "./routes/generate";
import modelRouter from "./routes/model";
import projectRouter from "./routes/project";
import collectionRouter from "./routes/collection";
import mockRouter from "./routes/mock";
import { stopAll, stopAllSync } from "./services/projectRunner";

const app = express();
const PORT = 4000;
const VERSION = "1.0.0";

app.use(cors());
app.use(express.json({ limit: "10mb" }));

app.use("/api/analyze", analyzeRouter);
app.use("/api/proxy", proxyRouter);
app.use("/api/ai-chat", aiChatRouter);
app.use("/api/generate", generateRouter);
app.use("/api/model", modelRouter);
app.use("/api/project", projectRouter);
app.use("/api/collection", collectionRouter);
app.use("/api/mock", mockRouter);

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

const server = app.listen(PORT, () => {
  console.log(`reqflow backend running on http://localhost:${PORT}`);
});

// A project ReqFlow started to verify a change must not outlive ReqFlow holding
// the port. The next launch would find it, decide it is someone else's server,
// and refuse to touch the thing it started itself.
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => {
    stopAll().finally(() => server.close(() => process.exit(0)));
  });
}

// A crash is the case where a leaked server hurts most: nobody chose it, so
// nobody goes looking. exit handlers cannot await, so this is the synchronous
// best effort — the signal handlers above are the ones that do it properly.
process.on("uncaughtException", (err) => {
  console.error("[reqflow] uncaught:", err);
  stopAllSync();
  process.exit(1);
});
process.on("exit", stopAllSync);