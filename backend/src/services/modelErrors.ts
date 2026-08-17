import { providerName } from "./llm";

// What the developer is told when the model call fails.
//
// This lives here rather than inside a route because two places need to say the
// same thing: the agent, when a request fails mid-run, and the model status
// check behind the dot in Settings. They were saying different things — one a
// sentence, the other seven hundred characters of the provider's JSON.

// The free tier answers 503 "high demand" often enough that a run across a
// dozen endpoints will meet one. It clears on its own, so it is worth waiting
// out rather than handing the developer the provider's URL.
export const RETRYABLE = /\b(429|500|502|503|504)\b/;

// A spent daily quota arrives as a 429 too, and means the opposite: waiting will
// not fix it, and neither will asking again.
export const QUOTA_SPENT = /quota|exhausted|RESOURCE_EXHAUSTED/i;

export function readableModelError(err: any): string {
  const raw = String(err?.message || err);

  // A local model has no key and no quota, so naming either would send the
  // developer to check a file that has nothing to do with it. What goes wrong
  // locally is the runtime not being up or the model not being pulled, and the
  // provider already says so in those words.
  if (providerName() === "local") {
    if (/ECONNREFUSED|not listening|nothing is listening/i.test(raw)) {
      return "The local model is not reachable. Start your runtime, or check LOCAL_MODEL_URL in backend/.env.";
    }
    return raw;
  }

  // Order matters here, and it was wrong. A used-up daily quota arrives as a
  // 429, so the retryable branch answered first and told the developer to ask
  // again — advice that cannot work, for a condition that lasts until the quota
  // resets. Asking twice is cheap; being told to keep asking a wall is not.
  if (QUOTA_SPENT.test(raw)) {
    return (
      "The model's daily quota is used up, so asking again will not help until it resets. " +
      "Everything above already happened. Add billing to the key in backend/.env, or switch " +
      "to a local model in Settings to keep working offline."
    );
  }
  if (/api[_ ]?key|permission|401|403/i.test(raw)) {
    return "The model rejected the API key. Check GEMINI_API_KEY in backend/.env.";
  }
  if (RETRYABLE.test(raw)) {
    return "The model is busy right now. Everything above already happened; ask again to carry on.";
  }

  // Anything unrecognised is still the provider's own words, but a wall of JSON
  // on a status line is not a message. The first sentence carries the meaning.
  return raw.split("\n")[0].slice(0, 200);
}
