export interface GMXmlHttpRequestOptions {
  method: "GET" | "POST" | "PUT" | "DELETE" | "HEAD";
  url: string;
  headers?: GMRequestHeaders; // Optional additional headers
  data?: string | FormData | null; // Request body for POST/PUT
  binary?: boolean; // Send the data string as a binary blob
  timeout?: number; // Timeout in milliseconds
  responseType?: "arraybuffer" | "blob" | "json" | "text" | ""; // Expected response type
  onload?: (response: GMXmlHttpRequestResponse) => void; // Success callback
  onerror?: (response: GMXmlHttpRequestResponse) => void; // Error callback
  ontimeout?: (response: GMXmlHttpRequestResponse) => void; // Timeout callback
  onabort?: (response: GMXmlHttpRequestResponse) => void; // Abort callback
  onprogress?: (event: ProgressEvent<XMLHttpRequestEventTarget>) => void; // Progress callback
  synchronous?: boolean; // true for synchronous request (not recommended)
  username?: string; // Username for basic authentication
  password?: string; // Password for basic authentication
  overrideMimeType?: string; // Override MIME type
  anonymous?: boolean; // Send request without credentials (cookies, HTTP auth)
  fetch?: boolean; // Use the browser's fetch API where possible
  revalidate?: boolean; // Force revalidation of the cache by the server
}

export interface GMXmlHttpRequestResponse {
  readonly readyState: number; // 0 = Unsent, 1 = Open, 2 = Headers received, 3 = Loading, 4 = Done
  readonly responseHeaders: string; // Headers received from the server
  readonly responseText: string; // The response in text format
  readonly responseXML?: Document | null; // The response as XML (if applicable)
  readonly response?: any; // The response data (based on responseType)
  readonly status: number; // HTTP status code (e.g. 200, 404)
  readonly statusText: string; // Status text (e.g. "OK", "Not Found")
  readonly finalUrl: string; // Final URL of the request after redirects
}
