const CALL_INTENT = /\b(call|meet|meeting|zoom)\b/i;

export function mentionsCallIntent(value: string): boolean {
  return CALL_INTENT.test(value);
}
