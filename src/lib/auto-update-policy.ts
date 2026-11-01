export const AUTO_UPDATE_DELAY_MS = 60_000;
export type AutoUpdateInputs = {
  enabled: boolean; configurable: boolean; ready: boolean; preview: boolean;
  visible: boolean; busy: boolean; blocked: boolean; hasDraft: boolean;
  revision: string | null; skipped: string | null; attempted: string | null;
  noticedAt: number; lastActivityAt: number; now: number;
};
export function autoUpdateSeconds(input: AutoUpdateInputs): number | null {
  if (!input.enabled || !input.configurable || !input.ready || input.preview || !input.visible || input.busy || input.blocked || input.hasDraft ||
      !input.revision || input.skipped === input.revision || input.attempted === input.revision) return null;
  return Math.max(0, Math.ceil((Math.max(input.noticedAt, input.lastActivityAt) + AUTO_UPDATE_DELAY_MS - input.now) / 1000));
}
