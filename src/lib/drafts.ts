export const DRAFT_CHANGED_EVENT = "omnicrm-draft-changed";

const STORAGE_KEY = "omnicrm-conversation-drafts-v1";
const MAX_SAVED_DRAFTS = 250;

export type ConversationDraft = {
  text: string;
  updatedAt: string;
};

export type ConversationDrafts = Record<string, ConversationDraft>;

export function loadConversationDrafts(): ConversationDrafts {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(
          ([conversationId, value]) =>
            !!conversationId &&
            !!value &&
            typeof value === "object" &&
            typeof (value as ConversationDraft).text === "string"
        )
        .map(([conversationId, value]) => [conversationId, value as ConversationDraft])
    );
  } catch {
    return {};
  }
}

export function loadConversationDraft(conversationId: string): string {
  return loadConversationDrafts()[conversationId]?.text ?? "";
}

export function saveConversationDraft(
  conversationId: string,
  text: string
): ConversationDrafts {
  const drafts = loadConversationDrafts();
  if (text.trim()) {
    drafts[conversationId] = { text, updatedAt: new Date().toISOString() };
  } else {
    delete drafts[conversationId];
  }

  const trimmed = Object.fromEntries(
    Object.entries(drafts)
      .sort(
        (left, right) =>
          new Date(right[1].updatedAt).getTime() -
          new Date(left[1].updatedAt).getTime()
      )
      .slice(0, MAX_SAVED_DRAFTS)
  );

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    window.dispatchEvent(
      new CustomEvent(DRAFT_CHANGED_EVENT, {
        detail: { conversationId, draft: trimmed[conversationId] ?? null },
      })
    );
  } catch {
    // Draft persistence is a convenience; a blocked/full local store should
    // never prevent the composer itself from working.
  }
  return trimmed;
}
