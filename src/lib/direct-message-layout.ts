import type { MessageDTO } from "./types";

/** Compact routine timestamps, never delivery warnings or unverified X previews. */
export function showDirectMessageTimestamp({
  lastOfRun,
  focused,
  deliveryStatus,
  externalKey,
}: {
  lastOfRun: boolean;
  focused: boolean;
  deliveryStatus: MessageDTO["deliveryStatus"] | undefined;
  externalKey: MessageDTO["externalKey"];
}): boolean {
  return lastOfRun || focused || Boolean(externalKey?.startsWith("x:preview:")) ||
    Boolean(deliveryStatus && deliveryStatus !== "sent");
}
