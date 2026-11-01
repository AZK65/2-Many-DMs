export type MessageMutationAction = "edit" | "delete";
type Target = {
  direction: string; externalKey?: string | null; body: string;
  createdAt: string | Date; mediaType?: string | null; deliveryStatus?: string | null;
  deletedAt?: string | Date | null; mutationState?: string | null;
};

/** One capability policy for the browser and worker. Never infer support from
 * the platform logo: personal Discord and X browser sessions are different
 * from official bot/API connections. */
export function messageMutationPolicy(platform: string, driver: string | null | undefined, message: Target, now = Date.now()) {
  const supported = platform === "telegram" || platform === "whatsapp" || (platform === "discord" && driver === "bot");
  const maxLength = platform === "discord" ? 2000 : platform === "telegram" ? 4096 : 65536;
  const age = now - new Date(message.createdAt).getTime();
  const ready = supported && message.direction === "out" && !!message.externalKey &&
    !message.externalKey.includes(":pending:") && !message.externalKey.includes(":preview:") &&
    (!message.deliveryStatus || message.deliveryStatus === "sent") && !message.deletedAt && !message.mutationState &&
    Number.isFinite(age) && age >= -60_000;
  return {
    supported,
    edit: ready && !message.mediaType && !!message.body.trim() && (platform !== "whatsapp" || age < 15 * 60_000),
    delete: ready && (platform !== "whatsapp" || age < 48 * 60 * 60_000),
    maxLength,
  };
}

/** A native ID must belong to this exact conversation, never a suffix-only match. */
export function nativeMutationId(platform: string, chat: string, key: string): string {
  const prefix = `${platform}:${chat}:`;
  if (!key.startsWith(prefix)) throw new Error("The message identity does not match this conversation.");
  const id = key.slice(prefix.length);
  if (!(platform === "whatsapp" ? /^[A-Za-z0-9_-]{6,128}$/ : /^\d+$/).test(id)) throw new Error("This message has no verified native ID yet.");
  return id;
}
