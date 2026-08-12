export interface DetectedRoute {
    method: string;
    path: string;
    description: string;
    params: string[];
    body: Record<string, any> | null;
  }
  
  export interface ProxyRequest {
    method: string;
    url: string;
    headers?: Record<string, string>;
    body?: any;
  }
  
  // one metric out of the target server's Server-Timing header. duration is
  // null when the server named a span but sent no dur for it.
  export interface ServerTimingSpan {
    name: string;
    description: string | null;
    duration: number | null;
  }

  export interface ProxyResponse {
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
    // reported by the target server, not measured here. empty when it sent no
    // Server-Timing header, which is the common case.
    serverTiming: ServerTimingSpan[];
    blocked?: boolean;
  }