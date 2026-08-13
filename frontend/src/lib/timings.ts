import { ApiResponse } from "../types";

// every send is already measured. keeping a few of those measurements per
// endpoint is what turns "826 ms" into "826 ms, and it used to be 140".

export interface TimingSample {
  at: number;
  status: number;
  total: number;
  ttfb: number;
  download: number;
  // the server's own Server-Timing spans, when it reports any
  spans: Record<string, number>;
}

// keyed by method and path, query strings dropped so ?status=open and
// ?status=closed compare against the same endpoint
export type TimingHistory = Record<string, TimingSample[]>;

const MAX_SAMPLES = 20;

// under this many prior runs there is no baseline worth quoting. one cold start
// would otherwise become "the normal time".
const MIN_FOR_BASELINE = 3;

// a run has to be both proportionally and absolutely slower before it is called
// out. without the absolute floor, 2 ms to 5 ms reads as a 2.5x regression.
const SLOW_RATIO = 1.5;
const SLOW_ABSOLUTE_MS = 20;

// a 401 that is rejected before any work happens and a 200 that returns a
// payload are not the same operation, so they do not belong in one baseline.
// comparing across them reports "16x slower" the moment you log in.
function sameKind(a: number, b: number): boolean {
  return Math.floor(a / 100) === Math.floor(b / 100);
}

export function endpointKey(method: string, url: string): string {
  // "localhost:3001/x" does not throw: URL reads localhost: as the protocol and
  // hands back "3001/x" as the path. checking the protocol is what separates a
  // real url from a half typed one.
  let path = url.split("?")[0];
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      path = parsed.pathname;
    }
  } catch {
    // keep the split fallback
  }
  return `${method.toUpperCase()} ${path}`;
}

export function sampleFrom(response: ApiResponse): TimingSample {
  const spans: Record<string, number> = {};
  for (const span of response.serverTiming ?? []) {
    if (typeof span.duration === "number") spans[span.name] = span.duration;
  }

  return {
    at: Date.now(),
    status: response.status,
    total: response.timing.total,
    ttfb: response.timing.ttfb,
    download: response.timing.download,
    spans,
  };
}

export function record(
  history: TimingHistory,
  method: string,
  url: string,
  response: ApiResponse
): TimingHistory {
  // a blocked or failed request measures the failure, not the endpoint
  if (!response.status || response.status === 0) return history;

  const key = endpointKey(method, url);
  const next = [...(history[key] || []), sampleFrom(response)].slice(-MAX_SAMPLES);
  return { ...history, [key]: next };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export interface PhaseComparison {
  name: string;
  current: number;
  baseline: number;
  ratio: number;
  slower: boolean;
  runs: number;
}

// median, not mean, so a single cold start does not drag the baseline up and
// then hide every real regression behind it
function comparePhase(
  name: string,
  current: number,
  previous: number[]
): PhaseComparison | null {
  if (previous.length < MIN_FOR_BASELINE) return null;

  const baseline = median(previous);
  const ratio = baseline > 0 ? current / baseline : 1;

  return {
    name,
    current,
    baseline,
    ratio,
    slower: ratio >= SLOW_RATIO && current - baseline >= SLOW_ABSOLUTE_MS,
    runs: previous.length,
  };
}

// compares a response against the runs that came before it. pass the history
// from before this response was recorded, or exclude it yourself.
export function compare(
  history: TimingHistory,
  method: string,
  url: string,
  response: ApiResponse
): PhaseComparison[] {
  const prior = (history[endpointKey(method, url)] || []).filter((s) =>
    sameKind(s.status, response.status)
  );
  if (prior.length < MIN_FOR_BASELINE) return [];

  const out: PhaseComparison[] = [];

  const ttfb = comparePhase("ttfb", response.timing.ttfb, prior.map((s) => s.ttfb));
  if (ttfb) out.push(ttfb);

  const download = comparePhase("download", response.timing.download, prior.map((s) => s.download));
  if (download) out.push(download);

  for (const span of response.serverTiming ?? []) {
    if (typeof span.duration !== "number") continue;
    // only spans the server has reported before can be compared
    const seen = prior.filter((s) => span.name in s.spans).map((s) => s.spans[span.name]);
    const cmp = comparePhase(span.name, span.duration, seen);
    if (cmp) out.push(cmp);
  }

  return out;
}

// the one line summary for the response header, or null when there is not
// enough history to say anything honest
export function summarise(
  history: TimingHistory,
  method: string,
  url: string,
  response: ApiResponse
): { text: string; slower: boolean } | null {
  const prior = (history[endpointKey(method, url)] || []).filter((s) =>
    sameKind(s.status, response.status)
  );
  if (prior.length < MIN_FOR_BASELINE) return null;

  const baseline = median(prior.map((s) => s.total));
  const current = response.timing.total;
  const ratio = baseline > 0 ? current / baseline : 1;
  const runs = prior.length;

  if (ratio >= SLOW_RATIO && current - baseline >= SLOW_ABSOLUTE_MS) {
    return { text: `${ratio.toFixed(1)}× slower than usual (${Math.round(baseline)} ms over ${runs} runs)`, slower: true };
  }
  if (ratio <= 1 / SLOW_RATIO && baseline - current >= SLOW_ABSOLUTE_MS) {
    return { text: `faster than usual (${Math.round(baseline)} ms over ${runs} runs)`, slower: false };
  }
  return { text: `usual is ${Math.round(baseline)} ms over ${runs} runs`, slower: false };
}
