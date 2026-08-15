export interface DetectedRoute {
    method: string;
    path: string;
    description: string;
    params: string[];
    body: Record<string, any> | null;
  }
  
  // one metric out of the target server's Server-Timing header. duration is
  // null when the server named a span but sent no dur for it.
  export interface ServerTimingSpan {
    name: string;
    description: string | null;
    duration: number | null;
  }

  export interface ApiResponse {
    status: number;
    statusText: string;
    headers: Record<string, any>;
    data: any;
    timing: {
      total: number;
      // measured, not estimated. ttfb is the wait until the first byte of the
      // response, download is the time spent reading the body after that.
      ttfb: number;
      download: number;
    };
    // bytes. content-length when the server sent one, otherwise what we read
    size: number;
    sizeSource: "content-length" | "measured";
    // reported by the target server, not measured here. optional because a
    // workspace saved before this existed will not have it.
    serverTiming?: ServerTimingSpan[];
    blocked?: boolean;
  }

export interface TestCase {
  id: string;
  field: string;
  operator: string;
  value: string;
  passed: boolean | null;
}

export interface RequestTab {
  id: string;
  method: string;
  url: string;
  body: string;
  headers: { key: string; value: string; enabled: boolean }[];
  response: ApiResponse | null;
  loading: boolean;
  label: string;
  tests: TestCase[];
  // values for the :name placeholders in url. kept apart from the url so the
  // placeholder survives being filled in and can be changed again.
  pathParams: Record<string, string>;
}

export type SubTab =
  | "params"
  | "headers"
  | "body"
  | "auth"
  | "tests";

// Source for an endpoint the project does not have yet, written to match the
// files it does have. It is shown and copied, never written: putting code into
// someone's repository is a different decision from generating it, and it is
// not one this app makes.
export interface GeneratedLayer {
  layer: string;
  // where the code belongs, relative to the project root
  path: string;
  code: string;
}

// An endpoint the agent drafted a request for that the scan has not found in
// the project. Held only for the session: these are suggestions, and one that
// survived a restart would be indistinguishable from an endpoint that exists.
export interface GeneratedRoute {
  method: string;
  // taken off the url, for reading and for comparing against the scan
  path: string;
  url: string;
  label: string;
  // the tab the agent already opened for it, so clicking the row goes back to
  // that request instead of stacking another copy of it
  tabId: string;
}

export interface GeneratedEndpoint {
  method: string;
  path: string;
  summary: string;
  layers: GeneratedLayer[];
  request: { headers: Record<string, string>; body: any | null };
  // anything the developer still has to do by hand, e.g. a schema change
  notes: string[];
  // the real files the style was read from, named so the claim is checkable
  references: { layer: string; path: string; reason: string }[];
}

export interface HistoryEntry {
  id: string;
  method: string;
  url: string;
  status: number;
  timing: number;
  at: number;
}