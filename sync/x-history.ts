// Never substitute import time for a message's sent time. UUIDv4 XChat IDs
// contain no date; only legacy snowflakes and dates displayed by X are usable.
export function xSnowflakeDate(id: string, now = Date.now()): number | null {
  if (!/^\d{16,20}$/.test(id)) return null;
  const value = Number((BigInt(id) >> 22n) + 1288834974657n);
  return value >= Date.UTC(2010, 10, 4) && value <= now + 60_000 ? value : null;
}

export function parseXDate(raw: string | undefined, now = Date.now(), day?: string): number | null {
  const text = (raw || "").trim().replace(/[\u200e\u200f\u202f]/g, " ").replace(/\s+/g, " ");
  if (!text) return null;
  const valid = (value: number) => Number.isFinite(value) && value >= Date.UTC(2006, 0, 1) && value <= now + 60_000 ? value : null;
  if (/^\d{13}$/.test(text)) return valid(Number(text));
  if (/^\d{10}$/.test(text)) return valid(Number(text) * 1000);
  if (/^\d{4}-\d\d-\d\d(?:T|\s)/.test(text)) return valid(Date.parse(text));
  const relative = text.match(/^(\d+)\s*(s|m|h|d|w|seconds?|minutes?|hours?|days?|weeks?)(?: ago)?$/i);
  if (relative) {
    const unit = relative[2].toLowerCase()[0];
    return valid(now - Number(relative[1]) * ({s:1000,m:60000,h:3600000,d:86400000,w:604800000}[unit] || 0));
  }
  if (/^now$/i.test(text)) return now;
  const weekday = text.match(/^(Mon(?:day)?|Tue(?:sday)?|Wed(?:nesday)?|Thu(?:rsday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)(?:[, ·]+(?:at\s+)?(\d{1,2}:\d{2}\s*(?:AM|PM)))?$/i);
  if (weekday) {
    const result = new Date(now);
    const dayIndex = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].indexOf(weekday[1].slice(0, 3).toLowerCase());
    result.setDate(result.getDate() - (result.getDay() - dayIndex + 7) % 7);
    result.setHours(0, 0, 0, 0);
    return weekday[2] ? parseXDate(weekday[2], now, result.toISOString()) : result.getTime();
  }
  const relativeDayTime = text.match(/^(Today|Yesterday)(?:,?\s+(?:at\s+)?)?(\d{1,2}:\d{2}\s*(?:AM|PM))$/i);
  if (relativeDayTime) return parseXDate(relativeDayTime[2], now, relativeDayTime[1]);
  const time = text.match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i);
  if (time) {
    // A time alone does not tell us which day this historic bubble belongs to.
    const date = day ? parseXDate(day, now) : null;
    if (date === null) return null;
    const hours = Number(time[1]);
    const minutes = Number(time[2]);
    if (minutes > 59 || hours > (time[3] ? 12 : 23) || (time[3] && hours < 1)) return null;
    const result = new Date(date);
    result.setHours(time[3] ? hours % 12 + (/pm/i.test(time[3]) ? 12 : 0) : hours, minutes, 0, 0);
    return valid(result.getTime());
  }
  const today = new Date(now);
  if (/^(today|yesterday)$/i.test(text)) {
    today.setHours(0, 0, 0, 0);
    if (/yesterday/i.test(text)) today.setDate(today.getDate() - 1);
    return today.getTime();
  }
  // Explicit calendar labels only; never Date.parse arbitrary message text.
  const calendar = text.replace(/^(?:Mon(?:day)?|Tue(?:sday)?|Wed(?:nesday)?|Thu(?:rsday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?),?\s+/i, "");
  if (/^(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:,?\s+\d{4})?(?:[ ,·]+(?:at\s+)?\d{1,2}:\d{2}\s*(?:AM|PM)?)?$/i.test(calendar)) {
    const hasYear = /\b\d{4}\b/.test(calendar);
    let candidate = calendar.replace(/\s+at\s+|\s*·\s*/g, " ");
    if (!hasYear) candidate = candidate.replace(/^(\w+\s+\d{1,2})/, `$1, ${today.getFullYear()}`);
    let value = Date.parse(candidate);
    if (!hasYear && value > now + 60_000) {
      const previousYear = new Date(value);
      previousYear.setFullYear(previousYear.getFullYear() - 1);
      value = previousYear.getTime();
    }
    return valid(value);
  }
  return null;
}

export type XHistoryMessage = { id: string; text: string; direction: "in" | "out"; timestamp?: number | null; minutePrecision?: boolean; attachments?: Array<{ url: string | null; type?: string }> };

export function stableXInboxDate(label: string, parsed: number | null, previous: number | undefined): number | null {
  const relative = label.match(/^(\d+)\s*([smhdw])$/i);
  const granularity = relative ? ({ s:1000, m:60000, h:3600000, d:86400000, w:604800000 }[relative[2].toLowerCase()] || 0) : /^now$/i.test(label) ? 60000 : 0;
  // Both observations are rounded estimates, not exact send times. X can keep
  // "now" for over a minute, and the 5s polling boundary adds jitter. A strict
  // 60s comparison created new IDs for the same preview at 60.027s / 64.254s.
  // Native IDs still preserve genuinely repeated messages during full repair.
  const uncertainty = Math.max(120_000, granularity) + 10_000;
  if (granularity && parsed && previous && Math.abs(parsed - previous) <= uncertainty) return previous;
  return parsed;
}

export type XLatestPreview = { preview: string; direction: "in" | "out"; timestamp?: number | null; timeLabel?: string };

// Seeing old history does not prove that the latest encrypted messages loaded.
// Check the actual latest inbox observation before advancing a repair checkpoint.
export function xHistoryMatchesPreview(
  messages: XHistoryMessage[],
  preview?: XLatestPreview
): boolean {
  if (!preview?.preview) return true;
  const normalize = (value: string) => value.normalize("NFKC").replace(/[\u200b-\u200f\ufeff]/g, "").replace(/\s+/g, " ").trim();
  const body = normalize(preview.preview);
  const unit = preview.timeLabel?.match(/^\d+\s*([hdw])$/i)?.[1]?.toLowerCase();
  const tolerance = unit ? ({ h: 3600000, d: 86400000, w: 604800000 }[unit] || 0) + 130000 : 130000;
  return messages.some(message => {
    if (message.direction !== preview.direction) return false;
    if (preview.timestamp && (!message.timestamp || Math.abs(message.timestamp - preview.timestamp) > tolerance)) return false;
    if (normalize(message.text) === body) return true;
    const kind = /^(?:sent|shared) (?:a |an )?(photo|image|video|gif|voice message|audio message|file|document|attachment)$/i.exec(body)?.[1]?.toLowerCase();
    return Boolean(kind && message.attachments?.some(media =>
      /photo|image/.test(kind) ? media.type === "image" : /video|gif/.test(kind) ? media.type === "video" : /voice|audio/.test(kind) ? media.type === "audio" : media.type === "file"));
  });
}

export function mergeXHistory<T extends XHistoryMessage>(windows: T[][]): T[] {
  // Each window is oldest-first. Prepend newly discovered older rows, while
  // retaining the native ID so repeated bodies remain separate messages.
  const found = new Map<string, T>();
  for (const window of [...windows].reverse()) {
    for (const message of window) {
      const existing = found.get(message.id);
      if (!existing) found.set(message.id, message);
      else {
        const attachments = (message.attachments?.filter((media) => media.url).length || 0) > (existing.attachments?.filter((media) => media.url).length || 0) ? message.attachments : existing.attachments || message.attachments;
        found.set(message.id, { ...existing, timestamp: existing.timestamp || message.timestamp, attachments });
      }
    }
  }
  return [...found.values()].sort((a, b) => a.timestamp && b.timestamp ? a.timestamp - b.timestamp : 0);
}

// X often exposes only a minute for an entire run of bubbles. Use the native
// DOM order as a millisecond ordering tie-break, not the import
// clock, so promoting older preview rows doesn't shuffle that run in the UI.
// Exact timestamps (including locally sent messages) are left unchanged.
export function orderXMinuteMessages<T extends XHistoryMessage>(messages: T[]): T[] {
  const seen = new Map<number, number>();
  return messages.map(message => {
    if (!message.minutePrecision || !message.timestamp || message.timestamp % 60_000 !== 0) return message;
    const index = seen.get(message.timestamp) || 0;
    seen.set(message.timestamp, index + 1);
    return { ...message, timestamp: message.timestamp + Math.min(index, 59_999) };
  });
}
