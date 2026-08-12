export interface DetectedRoute {
    method: string;
    path: string;
    description: string;
    params: string[];
    body: Record<string, any> | null;
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
}

export type SubTab =
  | "params"
  | "headers"
  | "body"
  | "auth"
  | "prerequest"
  | "tests";

export interface HistoryEntry {
  id: string;
  method: string;
  url: string;
  status: number;
  timing: number;
  at: number;
}