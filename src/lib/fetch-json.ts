function responseErrorMessage(
  response: Response,
  body: unknown,
  label: string
): string {
  if (body && typeof body === "object" && "error" in body) {
    const error = (body as { error?: unknown }).error;
    if (typeof error === "string" && error.trim()) return error;
  }

  return `${label} is unavailable (${response.status}).`;
}

/** Parse an API response without throwing the browser's opaque empty-JSON error. */
export async function parseJsonResponse<T>(
  response: Response,
  label = "Request"
): Promise<T> {
  const text = await response.text();
  let body: unknown;

  if (text.trim()) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(
        response.ok
          ? `${label} returned an invalid response.`
          : `${label} is unavailable (${response.status}).`
      );
    }
  }

  if (!response.ok) throw new Error(responseErrorMessage(response, body, label));
  if (!text.trim()) throw new Error(`${label} returned an empty response.`);

  return body as T;
}

export async function fetchJson<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
  label?: string
): Promise<T> {
  const response = await fetch(input, init);
  return parseJsonResponse<T>(response, label);
}
