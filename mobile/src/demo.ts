import { OmniApi } from "./api";
import type { Account, Automation, ContactCard, Conversation, HealthResponse, ListeningResponse, LocalFile, Message, SocialLead, TodoTask } from "./types";

const now = Date.now();
const iso = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();

const conversations: Conversation[] = [
  {
    id: "demo-1", platform: "telegram", externalId: "1001", unread: 3, lastMessageAt: iso(4),
    lastMessage: "Would Thursday afternoon work for onboarding?", lastDirection: "in", pinned: true,
    hidden: false, inboxCategory: "general", status: "open", intent: "onboarding", followUpAt: null,
    snoozedUntil: null, lastOpenedAt: iso(1440), priority: true, todo: true, todoNote: "Confirm kickoff time",
    todoCompleted: false, todoAddedAt: iso(60), translationEnabled: false, translationLanguageCode: null,
    translationLanguageName: null, folderIds: [], account: { id: "account-1", label: "Main Telegram", driver: "mtproto", status: "connected" },
    isGroup: false, topicOf: null,
    contact: { id: "contact-1", name: "Maya Chen", handle: "@mayachen", company: "Northstar Labs", email: "maya@example.com", phone: null, notes: "Interested in the team plan.", stage: "won", avatarUrl: null, tags: [{ id: "tag-1", name: "VIP", color: "#1FE88A" }] },
  },
  {
    id: "demo-2", platform: "whatsapp", externalId: "1002", unread: 0, lastMessageAt: iso(47),
    lastMessage: "Sent the revised proposal just now", lastDirection: "in", pinned: false,
    hidden: false, inboxCategory: "general", status: "waiting", intent: "prospect", followUpAt: iso(-1440),
    snoozedUntil: null, lastOpenedAt: iso(60), priority: false, todo: false, todoNote: null,
    todoCompleted: false, todoAddedAt: null, translationEnabled: false, translationLanguageCode: null,
    translationLanguageName: null, folderIds: [], account: { id: "account-2", label: "Work WhatsApp", driver: "baileys", status: "connected" },
    isGroup: false, topicOf: null,
    contact: { id: "contact-2", name: "Jordan Brooks", handle: "+1 416 555 0142", company: "Fieldnote", email: "jordan@example.com", phone: "+1 416 555 0142", notes: null, stage: "negotiating", avatarUrl: null, tags: [{ id: "tag-2", name: "Inbound", color: "#69A7FF" }] },
  },
  {
    id: "demo-3", platform: "x", externalId: "1003", unread: 1, lastMessageAt: iso(128),
    lastMessage: "Your unified inbox looks perfect for our team", lastDirection: "in", pinned: false,
    hidden: false, inboxCategory: "general", status: "open", intent: "prospect", followUpAt: null,
    snoozedUntil: null, lastOpenedAt: null, priority: false, todo: false, todoNote: null,
    todoCompleted: false, todoAddedAt: null, translationEnabled: false, translationLanguageCode: null,
    translationLanguageName: null, folderIds: [], account: { id: "account-3", label: "@omni", driver: "api", status: "connected" },
    isGroup: false, topicOf: null,
    contact: { id: "contact-3", name: "Avery Singh", handle: "@averybuilds", company: "Arc Studio", email: null, phone: null, notes: null, stage: "lead", avatarUrl: null, tags: [] },
  },
  {
    id: "demo-4", platform: "discord", externalId: "1004", unread: 0, lastMessageAt: iso(1460),
    lastMessage: "Thanks, that fixed it!", lastDirection: "in", pinned: false,
    hidden: false, inboxCategory: "general", status: "done", intent: "support", followUpAt: null,
    snoozedUntil: null, lastOpenedAt: iso(1400), priority: false, todo: false, todoNote: null,
    todoCompleted: false, todoAddedAt: null, translationEnabled: false, translationLanguageCode: null,
    translationLanguageName: null, folderIds: [], account: { id: "account-4", label: "Omni Support", driver: "bot", status: "connected" },
    isGroup: false, topicOf: null,
    contact: { id: "contact-4", name: "Theo Martin", handle: "theom", company: null, email: null, phone: null, notes: null, stage: "contacted", avatarUrl: null, tags: [{ id: "tag-3", name: "Support", color: "#A78BFA" }] },
  },
];

const messageMap: Record<string, Message[]> = {
  "demo-1": [
    { id: "m1", body: "Hi Maya — your proposal is approved. Want to book the team onboarding this week?", direction: "out", mediaType: null, mediaUrl: null, mediaName: null, createdAt: iso(32), replyToExternalKey: null, replyPreview: null, replySender: null, deliveryStatus: "sent", senderName: null, senderAvatarUrl: null, senderTags: [] },
    { id: "m2", body: "Amazing, thank you! Would Thursday afternoon work for onboarding?", direction: "in", mediaType: null, mediaUrl: null, mediaName: null, createdAt: iso(4), replyToExternalKey: null, replyPreview: null, replySender: null, senderName: null, senderAvatarUrl: null, senderTags: [], reactions: [{ emoji: "🎉", count: 1, who: ["You"] }] },
  ],
  "demo-2": [
    { id: "m3", body: "The missing ownership field is on page two.", direction: "out", mediaType: null, mediaUrl: null, mediaName: null, createdAt: iso(80), replyToExternalKey: null, replyPreview: null, replySender: null, deliveryStatus: "sent", senderName: null, senderAvatarUrl: null, senderTags: [] },
    { id: "m4", body: "Sent the revised proposal just now", direction: "in", mediaType: null, mediaUrl: null, mediaName: null, createdAt: iso(47), replyToExternalKey: null, replyPreview: null, replySender: null, senderName: null, senderAvatarUrl: null, senderTags: [] },
  ],
};

let todos: TodoTask[] = [
  { id: "todo-1", title: "Review Jordan's revised proposal", note: null, priority: true, completed: false, createdAt: iso(60), updatedAt: iso(60), completedAt: null },
  { id: "todo-2", title: "Update onboarding snippet", note: "Add the new booking link", priority: false, completed: false, createdAt: iso(180), updatedAt: iso(180), completedAt: null },
];

let automations: Automation[] = [
  { id: "auto-1", name: "Warm lead follow-up", enabled: true, trigger: "no_reply", keyword: null, noReplyDays: 3, platform: null, schedule: "daily", everyNDays: null, cooldownDays: 7, lastRunAt: iso(1440), matchCount: 4 },
  { id: "auto-2", name: "Pricing keyword", enabled: true, trigger: "keyword", keyword: "pricing", noReplyDays: null, platform: null, schedule: "instant", everyNDays: null, cooldownDays: 7, lastRunAt: iso(300), matchCount: 1 },
  { id: "auto-3", name: "Friday check-in", enabled: false, trigger: "broadcast", keyword: null, noReplyDays: null, platform: "telegram", schedule: "manual", everyNDays: null, cooldownDays: 7, lastRunAt: null, matchCount: 8 },
];

const demoLead: SocialLead = {
  id: "lead-1", kind: "lead", postId: "1", watcher: "CRM buyers", username: "founderash",
  displayName: "Ash Rivera", bio: "Building tools for independent agencies", followers: "4,800",
  content: "Looking for one inbox that can finally keep our WhatsApp, Telegram, and X leads organized. Any good self-hosted options?",
  url: "https://x.com", matchedQuery: "unified inbox", tier: "HOT", reason: "Actively asking for a multi-channel CRM recommendation.",
  status: "new", rating: null, postedAt: iso(22), receivedAt: iso(20),
};

export class DemoApi extends OmniApi {
  constructor() { super("demo://omni"); }
  override assetUrl(value: string | null) { return value; }
  override async health(): Promise<HealthResponse> { return { ok: true, service: "omni-crm", apiVersion: 1, serverTime: new Date().toISOString(), database: "ready", tailscaleUser: null, capabilities: ["inbox", "messages", "pipeline", "todos", "listening", "automations"] }; }
  override async conversations() { return conversations.map((item) => ({ ...item })); }
  override async messages(id: string) { return { messages: (messageMap[id] || []).map((item) => ({ ...item })), hasMore: false }; }
  override async updateConversation(id: string, body: Partial<Conversation>) { Object.assign(conversations.find((item) => item.id === id) || {}, body); return { ok: true as const }; }
  override async sendMessage(id: string, body: string) { const message: Message = { id: `m-${Date.now()}`, body, direction: "out", mediaType: null, mediaUrl: null, mediaName: null, createdAt: new Date().toISOString(), replyToExternalKey: null, replyPreview: null, replySender: null, deliveryStatus: "sent", senderName: null, senderAvatarUrl: null, senderTags: [] }; (messageMap[id] ||= []).push(message); return message; }
  override async sendFile(id: string, file: LocalFile, body = "") { return this.sendMessage(id, body || `📎 ${file.name}`); }
  override async contacts(): Promise<ContactCard[]> { return conversations.map(({ contact, platform, id, lastMessage, lastMessageAt }) => ({ ...contact, platform, conversationId: id, lastMessage, lastMessageAt })); }
  override async updateContact(id: string, body: Partial<ContactCard>) { const contact = conversations.find((item) => item.contact.id === id)?.contact; if (contact) Object.assign(contact, body); return { ...body, id } as ContactCard; }
  override async todos() { return todos.map((item) => ({ ...item })); }
  override async createTodo(title: string) { const task: TodoTask = { id: `todo-${Date.now()}`, title, note: null, priority: false, completed: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), completedAt: null }; todos = [task, ...todos]; return task; }
  override async updateTodo(id: string, body: Partial<TodoTask>) { const task = todos.find((item) => item.id === id)!; Object.assign(task, body, { updatedAt: new Date().toISOString() }); return { ...task }; }
  override async deleteTodo(id: string) { todos = todos.filter((item) => item.id !== id); return { ok: true as const }; }
  override async listening(kind: "lead" | "support"): Promise<ListeningResponse> { const lead = kind === "lead" ? demoLead : { ...demoLead, id: "support-1", kind: "support" as const, username: "northstarhq", displayName: "Northstar Labs", content: "@omni messages are arriving twice in our team inbox this morning.", reason: "Existing customer reports a product issue.", tier: "HOT" as const }; return { leads: [lead], counts: { hot: 1, warm: 0, rejected: 0, support: 1, supportNew: 1 }, lastRun: { createdAt: iso(9), found: 14, fresh: 2 } }; }
  override async updateLead(_id: string, body: Partial<SocialLead>) { Object.assign(demoLead, body); return { lead: { ...demoLead } }; }
  override async automations() { return automations.map((item) => ({ ...item })); }
  override async updateAutomation(id: string, body: Partial<Automation>) { const automation = automations.find((item) => item.id === id)!; Object.assign(automation, body); return { ...automation }; }
  override async runAutomation() { return { sent: 3, failed: 0, skipped: 1 }; }
  override async accounts(): Promise<Account[]> { return [
    { id: "account-1", platform: "telegram", label: "Main Telegram", status: "connected", detail: null, driver: "mtproto", proxyRegion: null },
    { id: "account-2", platform: "whatsapp", label: "Work WhatsApp", status: "connected", detail: null, driver: "baileys", proxyRegion: "Toronto" },
    { id: "account-3", platform: "x", label: "@omni", status: "connected", detail: null, driver: "api", proxyRegion: null },
    { id: "account-4", platform: "discord", label: "Omni Support", status: "connected", detail: null, driver: "bot", proxyRegion: null },
  ]; }
}
