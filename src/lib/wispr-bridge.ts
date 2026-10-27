// Always the viewer's computer, never Omni's server/VPS. No audio or drafts cross this bridge.
export const WISPR_HELPER_URL = "http://127.0.0.1:43821";
export const WISPR_TOKEN_KEY = "omni:wispr-helper:token:v1";
export const WISPR_SETUP_KEY = "omni:wispr-helper:setup:v1";
export type WisprStatus = { version: number; installed: boolean; running: boolean; accessibility: boolean };

export async function wisprRequest<T>(route: "pair" | "status" | "toggle", payload: Record<string, string> = {}, token?: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${WISPR_HELPER_URL}/${route}`, {
      method: "POST", credentials: "omit", cache: "no-store",
      headers: { "Content-Type": "application/json", ...(token ? { "X-Omni-Token": token } : {}) },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(4000),
    });
  } catch {
    throw Error(route === "toggle"
      ? "Could not confirm the shortcut. Check Wispr’s Flow Bar before trying again—it may have started."
      : "Cannot reach Omni Dictation on this Mac. Start the helper and allow this site’s local-network access if your browser asks. No browser security changes are needed.");
  }
  const data = await response.json() as T & { error?: string };
  if (!response.ok) {
    if (response.status === 401) localStorage.removeItem(WISPR_TOKEN_KEY);
    throw Error(data.error || "The dictation helper could not complete this request.");
  }
  return data;
}

export function wisprSetupProblem(status: WisprStatus): string | null {
  if (status.version !== 1) return "Update Omni Dictation to the version included with Omni.";
  if (!status.installed) return "Install Wispr Flow on this Mac, sign in, and complete its setup.";
  if (!status.running) return "Open Wispr Flow on this Mac before dictating.";
  if (!status.accessibility) return "Enable Omni Dictation in System Settings → Privacy & Security → Accessibility.";
  return null;
}

export function appendDictation(draft: string, transcript: string): string {
  const words = transcript.trim();
  if (!words) return draft;
  return draft + (draft && !/\s$/.test(draft) ? " " : "") + words;
}
