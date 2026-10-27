export function avatarErrorCode(error: unknown): number {
  const value = error as { data?: unknown; output?: { statusCode?: number } };
  // Baileys wraps stanza errors in Boom but puts WhatsApp's actual code in
  // `data`; output.statusCode is often the generic 500 wrapper.
  return typeof value?.data === "number" ? value.data : Number(value?.output?.statusCode || 0);
}

export function avatarUnavailable(error: unknown): boolean {
  return [401, 403, 404].includes(avatarErrorCode(error));
}
