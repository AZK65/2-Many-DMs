import type {
  Account,
  Automation,
  ContactCard,
  Conversation,
  HealthResponse,
  ListeningResponse,
  LocalFile,
  Message,
  SocialLead,
  TodoTask,
} from "./types";

export class ApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

export function normalizeServerUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) throw new ApiError("Enter your Tailscale Serve URL.");
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const parsed = new URL(withProtocol);
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
    throw new ApiError("Use the HTTPS address shown by Tailscale Serve.");
  }
  return parsed.toString().replace(/\/$/, "");
}

export class OmniApi {
  constructor(readonly baseUrl: string) {}

  assetUrl(value: string | null): string | null {
    if (!value) return null;
    if (/^https?:\/\//i.test(value)) return value;
    return `${this.baseUrl}${value.startsWith("/") ? "" : "/"}${value}`;
  }

  private async request<T>(path: string, init: RequestInit = {}, timeout = 15_000): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          Accept: "application/json",
          ...(init.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
          ...init.headers,
        },
        signal: controller.signal,
      });
      const text = await response.text();
      let body: unknown = null;
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          body = text;
        }
      }
      if (!response.ok) {
        const detail = body && typeof body === "object" && "error" in body
          ? String((body as { error: unknown }).error)
          : `Request failed (${response.status}).`;
        throw new ApiError(detail, response.status);
      }
      return body as T;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error instanceof Error && error.name === "AbortError") throw new ApiError("The private server did not respond in time.");
      throw new ApiError("Could not reach your private Omni server. Check Tailscale and the server address.");
    } finally {
      clearTimeout(timer);
    }
  }

  health() { return this.request<HealthResponse>("/api/mobile/health"); }
  conversations() { return this.request<Conversation[]>("/api/conversations"); }
  messages(conversationId: string, markRead = false) {
    return this.request<{ messages: Message[]; hasMore: boolean }>(
      `/api/conversations/${encodeURIComponent(conversationId)}/messages?limit=100${markRead ? "&markRead=1" : ""}`,
    );
  }
  updateConversation(id: string, body: Partial<Conversation>) {
    return this.request<{ ok: true }>(`/api/conversations/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  }
  async sendMessage(id: string, body: string): Promise<Message> {
    const result = await this.request<Message | { message: Message }>(`/api/conversations/${encodeURIComponent(id)}/messages`, {
      method: "POST",
      body: JSON.stringify({ body, clientMessageId: `ios-${Date.now()}-${Math.random().toString(36).slice(2)}` }),
    }, 30_000);
    return "message" in result ? result.message : result;
  }
  async sendFile(id: string, file: LocalFile, body = ""): Promise<Message> {
    const data = new FormData();
    data.append("body", body);
    data.append("clientMessageId", `ios-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    data.append("file", { uri: file.uri, name: file.name, type: file.mimeType } as unknown as Blob);
    const result = await this.request<Message | { message: Message }>(`/api/conversations/${encodeURIComponent(id)}/messages`, {
      method: "POST",
      body: data,
    }, 60_000);
    return "message" in result ? result.message : result;
  }
  contacts() { return this.request<ContactCard[]>("/api/contacts"); }
  updateContact(id: string, body: Partial<ContactCard>) {
    return this.request<ContactCard>(`/api/contacts/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  }
  todos() { return this.request<TodoTask[]>("/api/todos"); }
  createTodo(title: string) {
    return this.request<TodoTask>("/api/todos", { method: "POST", body: JSON.stringify({ title }) });
  }
  updateTodo(id: string, body: Partial<TodoTask>) {
    return this.request<TodoTask>(`/api/todos/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) });
  }
  deleteTodo(id: string) {
    return this.request<{ ok: true }>(`/api/todos/${encodeURIComponent(id)}`, { method: "DELETE" });
  }
  listening(kind: "lead" | "support") {
    return this.request<ListeningResponse>(`/api/listening/leads?kind=${kind}&status=all&limit=150`);
  }
  updateLead(id: string, body: Partial<SocialLead>) {
    return this.request<{ lead: SocialLead }>(`/api/listening/leads/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  }
  automations() { return this.request<Automation[]>("/api/automations"); }
  updateAutomation(id: string, body: Partial<Automation>) {
    return this.request<Automation>(`/api/automations/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  }
  runAutomation(id: string) {
    return this.request<{ sent: number; failed: number; skipped: number }>(`/api/automations/${encodeURIComponent(id)}/run`, { method: "POST" }, 60_000);
  }
  accounts() { return this.request<Account[]>("/api/accounts"); }
}
