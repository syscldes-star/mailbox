interface ApiSuccessResponse<T> {
  success: true;
  message: string;
  data: T;
}

interface ApiErrorResponse {
  success: false;
  message: string;
}

export class ApiError extends Error {
  status: number;
  /** Which request actually failed -- included so a person reporting
   * "the server returned an unexpected response" (or a screenshot of
   * it) carries enough information to diagnose without needing to
   * separately open DevTools and reproduce it live. */
  url: string;
  method: string;

  constructor(message: string, status: number, url: string, method: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.url = url;
    this.method = method;
  }
}

/**
 * Thin wrapper around fetch for our own API routes. Always sends
 * credentials (so the session cookie rides along), always parses the
 * {success, message, data} shape every route responds with, and throws a
 * typed ApiError with the server's own message on failure so callers can
 * show it directly rather than a generic "Something went wrong."
 */
export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    credentials: "include",
    headers:
      options.body && !(options.body instanceof FormData)
        ? { "Content-Type": "application/json", ...options.headers }
        : options.headers,
  });

  let json: ApiSuccessResponse<T> | ApiErrorResponse;
  try {
    json = await response.json();
  } catch {
    // Whatever came back genuinely isn't JSON at all -- almost always
    // means something outside this app's own route handlers responded
    // instead (a platform-level timeout page, a body-size-limit
    // rejection, a proxy error page), since every real route in this
    // app always responds with the {success, message, data} shape even
    // on its own internal errors. The previous version of this message
    // was completely opaque about which of those it actually was --
    // including the status code (and a short snippet of whatever text
    // did come back, when there is any) turns "the server returned an
    // unexpected response" from a dead end into something a person can
    // actually act on (413 means the request was too large; 504 means
    // it timed out; 502/503 means the platform itself had a problem).
    let bodySnippet = "";
    try {
      bodySnippet = (await response.clone().text()).slice(0, 200).trim();
    } catch {
      // response body already consumed or unreadable -- fine, the
      // status code alone is still far more useful than nothing.
    }
    const detail = bodySnippet ? `: ${bodySnippet}` : "";
    throw new ApiError(
      `The server returned an unexpected response (HTTP ${response.status})${detail}`,
      response.status,
      path,
      options.method ?? "GET"
    );
  }

  if (!json.success) {
    throw new ApiError(json.message, response.status, path, options.method ?? "GET");
  }

  return json.data;
}

export function apiGet<T>(path: string): Promise<T> {
  return apiFetch<T>(path, { method: "GET" });
}

export function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return apiFetch<T>(path, { method: "POST", body: body !== undefined ? JSON.stringify(body) : undefined });
}

export function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  return apiFetch<T>(path, { method: "PATCH", body: body !== undefined ? JSON.stringify(body) : undefined });
}

export function apiPut<T>(path: string, body?: unknown): Promise<T> {
  return apiFetch<T>(path, { method: "PUT", body: body !== undefined ? JSON.stringify(body) : undefined });
}

export function apiDelete<T>(path: string): Promise<T> {
  return apiFetch<T>(path, { method: "DELETE" });
}

/** For multipart/form-data uploads -- deliberately doesn't set
 * Content-Type, since the browser needs to set it itself (with the
 * multipart boundary included) when the body is a FormData instance. */
export function apiUpload<T>(path: string, formData: FormData): Promise<T> {
  return apiFetch<T>(path, { method: "POST", body: formData });
}
