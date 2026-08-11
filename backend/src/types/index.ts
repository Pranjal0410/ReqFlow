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
  
  export interface ProxyResponse {
    status: number;
    statusText: string;
    headers: Record<string, any>;
    data: any;
    timing: {
      total: number;
    };
  }