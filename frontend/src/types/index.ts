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

export interface HistoryEntry {
  id: string;
  method: string;
  url: string;
  status: number;
  timing: number;
  at: number;
}