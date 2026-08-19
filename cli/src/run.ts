// Running a collection outside the app.
//
// The app already knows how to do this: send each request in order, take the
// values one response owes the next, check what each one asserts. What it does
// not do is happen without someone watching. This is the same run, on a
// schedule or in a pipeline, with an exit code instead of a screen.
//
// It imports the app's own logic rather than restating it. A second
// implementation of "what does this assertion mean" would agree with the first
// until the day it did not, and the day it did not would be the day someone
// trusted a green pipeline over a red app.

import axios from "axios";
import { substitute, toMap } from "../../frontend/src/lib/variables";
import { applyPathParams } from "../../frontend/src/lib/pathParams";
import { runCaptures } from "../../frontend/src/lib/capture";
import { runAssertions, actualFor } from "../../frontend/src/lib/assertions";
import { fromCollection, Imported } from "../../frontend/src/lib/collection";

export interface RequestOutcome {
  name: string;
  method: string;
  url: string;
  status: number | null;
  ms: number;
  // an assertion that did not hold, in the words the app uses for it
  failures: string[];
  captured: string[];
  error: string | null;
}

export interface RunResult {
  outcomes: RequestOutcome[];
  passed: number;
  failed: number;
  errored: number;
}

export interface RunOptions {
  // overrides the collection's own, for the same requests against staging
  baseUrl?: string;
  // values for {{name}}, for the ones a committed file cannot carry
  variables?: Record<string, string>;
  timeoutMs?: number;
  onRequest?: (outcome: RequestOutcome) => void;
}

// A collection holds absolute urls, because that is what the app sends. Pointing
// the same run at another environment means replacing the origin and keeping
// everything after it.
export function withBaseUrl(url: string, baseUrl?: string): string {
  if (!baseUrl) return url;
  try {
    const target = new URL(baseUrl);
    const original = new URL(url);
    return new URL(original.pathname + original.search + original.hash, target).toString();
  } catch {
    // not a url yet — it may still hold an unresolved {{name}}, and saying so
    // by failing the request is clearer than guessing at what was meant
    return url;
  }
}

function describeFailure(field: string, operator: string, expected: string, actual: any): string {
  return `${field} ${operator} ${expected || ""} — was ${JSON.stringify(actual)}`.trim();
}

export async function runCollection(raw: any, options: RunOptions = {}): Promise<RunResult> {
  const read: Imported | null = fromCollection(raw);
  if (!read) throw new Error("that file has no requests in it");

  // the file's own variables first, then anything given on the command line,
  // which is where the values a committed file must not hold come from
  const vars: Record<string, string> = {
    ...toMap(read.variables),
    ...(options.variables || {}),
  };

  const outcomes: RequestOutcome[] = [];
  let passed = 0;
  let failed = 0;
  let errored = 0;

  for (const tab of read.tabs) {
    const started = Date.now();
    const outcome: RequestOutcome = {
      name: tab.label,
      method: tab.method,
      url: tab.url,
      status: null,
      ms: 0,
      failures: [],
      captured: [],
      error: null,
    };

    try {
      const url = withBaseUrl(
        applyPathParams(substitute(tab.url, vars), tab.pathParams || {}, vars),
        options.baseUrl
      );
      outcome.url = url;

      const headers: Record<string, string> = {};
      for (const h of tab.headers || []) {
        if (h.enabled === false || !h.key.trim()) continue;
        const value = substitute(h.value, vars);
        // a header whose value is still a placeholder was never filled in, and
        // sending "Bearer {{token}}" is a 401 that blames the server
        if (/\{\{.*\}\}/.test(value)) continue;
        headers[h.key] = value;
      }

      let body: any = undefined;
      if (["POST", "PUT", "PATCH"].includes(tab.method) && tab.body.trim()) {
        body = JSON.parse(substitute(tab.body, vars));
      }

      const res = await axios.request({
        method: tab.method as any,
        url,
        headers,
        data: body,
        timeout: options.timeoutMs ?? 30_000,
        // a 404 is an answer, and the assertions decide whether it is the right
        // one. Throwing on it would make every negative test an error.
        validateStatus: () => true,
      });

      outcome.status = res.status;
      outcome.ms = Date.now() - started;

      const asResponse: any = {
        status: res.status,
        data: res.data,
        headers: res.headers,
        timing: { total: outcome.ms },
        size: 0,
        sizeSource: "measured",
      };

      for (const { name, value } of runCaptures(tab.captures || [], asResponse)) {
        vars[name] = value;
        outcome.captured.push(name);
      }

      const checked = runAssertions(tab.tests || [], asResponse);
      for (const t of checked) {
        if (t.passed) passed++;
        else {
          failed++;
          outcome.failures.push(
            describeFailure(t.field, t.operator, t.value, actualFor(asResponse, t.field))
          );
        }
      }
    } catch (err: any) {
      errored++;
      outcome.ms = Date.now() - started;
      outcome.error =
        err instanceof SyntaxError
          ? `request body is not valid JSON: ${err.message}`
          : err?.message || "request failed";
    }

    outcomes.push(outcome);
    options.onRequest?.(outcome);
  }

  return { outcomes, passed, failed, errored };
}

