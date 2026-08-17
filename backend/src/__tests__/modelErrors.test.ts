import { readableModelError } from "../services/modelErrors";

// The message shown when the model call fails is the last thing standing
// between the developer and a blank panel, so it has to name the actual
// condition. A real 429 from Gemini carries both the number and the reason, and
// the two mean opposite things: one clears in seconds, the other lasts until
// the quota resets.
const DAILY_QUOTA_SPENT =
  "[GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/" +
  "v1beta/models/gemini-3.1-flash-lite:generateContent: [429 Too Many Requests] You exceeded " +
  "your current quota, please check your plan and billing details. " +
  "* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests";

const TRANSIENT_OVERLOAD =
  "[GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/" +
  "v1beta/models/gemini-3.1-flash-lite:generateContent: [503 Service Unavailable] " +
  "The model is overloaded. Please try again later.";

describe("readableModelError", () => {
  it("does not tell you to ask again when the quota is what ran out", () => {
    const msg = readableModelError(new Error(DAILY_QUOTA_SPENT));
    // this is the regression: the 429 branch used to answer first and say
    // "ask again to carry on", advice that cannot work until the quota resets
    expect(msg).not.toMatch(/ask again/i);
    expect(msg).toMatch(/quota/i);
    expect(msg).toMatch(/will not help/i);
  });

  it("points at the two ways out rather than leaving you stuck", () => {
    const msg = readableModelError(new Error(DAILY_QUOTA_SPENT));
    expect(msg).toMatch(/billing/i);
    expect(msg).toMatch(/local model/i);
  });

  it("still says to retry when retrying is what fixes it", () => {
    const msg = readableModelError(new Error(TRANSIENT_OVERLOAD));
    expect(msg).toMatch(/ask again/i);
    expect(msg).not.toMatch(/quota/i);
  });

  it("names the key when the key is what was rejected", () => {
    const msg = readableModelError(new Error("[401] API key not valid"));
    expect(msg).toMatch(/GEMINI_API_KEY/);
  });
});
