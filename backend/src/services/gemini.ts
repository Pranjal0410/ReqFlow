import { GoogleGenerativeAI } from "@google/generative-ai";
import { DetectedRoute } from "../types";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

export async function analyzeCode(files: { path: string; content: string }[]): Promise<DetectedRoute[]> {
  const model = genAI.getGenerativeModel({ model: "gemini-3.5-flash" });

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

return ONLY a valid JSON array. no markdown, no backticks, no explanation.

example format:
[{"method":"POST","path":"/users","description":"creates a new user","params":[],"body":{"name":"string","email":"string"}}]

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