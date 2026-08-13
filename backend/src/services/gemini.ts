import { GoogleGenerativeAI } from "@google/generative-ai";
import { DetectedRoute } from "../types";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

// gemini-3.5-flash caps at 20 requests a day on the free tier, which a few
// scans will burn through. the lite model has its own, much larger allowance.
const ANALYZE_MODEL = process.env.GEMINI_ANALYZE_MODEL || "gemini-3.1-flash-lite";

export async function analyzeCode(files: { path: string; content: string }[]): Promise<DetectedRoute[]> {
  const model = genAI.getGenerativeModel({ model: ANALYZE_MODEL });

  const codeBlock = files
    .map((f) => `// FILE: ${f.path}\n${f.content}`)
    .join("\n\n---\n\n");

  const prompt = `analyze this Node.js/Express code. extract every API route you find.

for each route return:
- method (GET, POST, PUT, DELETE)
- path (like /users or /users/:id)
- description (one line about what it does)
- params (array of path or query params)
- body (example JSON payload if its POST/PUT, null otherwise)

the body is going to be sent as-is by someone testing the endpoint, so fill it
with values that would actually pass. read the validators, schemas, enums and
defaults in the code and use them: if severity must be one of low, medium or
high, pick one of those, not the word "string". write a plausible title rather
than "string", a well formed email rather than "string", a number where a
number is expected. only fall back to a placeholder for a value the code gives
you no way to guess, such as an id of another record.

return ONLY a valid JSON array. no markdown, no backticks, no explanation.

example format:
[{"method":"POST","path":"/users","description":"creates a new user","params":[],"body":{"name":"Ada Lovelace","email":"ada@example.com","age":36}}]

code:
${codeBlock}`;

  const result = await model.generateContent(prompt);
  const text = result.response.text().trim();

  // clean up in case gemini wraps it in backticks
  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    console.error("gemini returned bad json:", cleaned);
    return [];
  }
}