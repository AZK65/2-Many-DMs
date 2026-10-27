// Serialized into the connector's page. Keep this function self-contained.
// X's test-id often sits on an inner list, not the element with overflow.
export function scrollXSurface(options: { kind: "inbox" | "messages"; direction: "older" | "newer" | "start"; resume?: number | null; category?: "general" | "spam" }) {
  const root = document.querySelector<HTMLElement>('[data-testid="xchatEmbedRoute"]')?.shadowRoot ?? document;
  const fallback = root.querySelector<HTMLElement>(options.kind === "inbox"
    ? options.category === "spam" ? '[data-testid="dm-message-requests-scroller"]' : '[data-testid="dm-conversation-scroller"],[data-testid="dm-message-requests-scroller"]'
    : '[data-testid="dm-message-list-container"],[data-testid="dm-message-list"]');
  // Anchor to the actual row/bubble. The similarly named XChat containers
  // are not reliably the scroll viewport and can belong to the other pane.
  const surface = (options.kind === "messages" ? root.querySelector<HTMLElement>('[data-testid="dm-message-scroller"]') : null) || root.querySelector<HTMLElement>(options.kind === "inbox"
    ? options.category === "spam" ? 'a[href^="/i/chat/requests/"]' : 'a[href^="/i/chat/"]:not([href="/i/chat/requests"]):not([href^="/i/chat/requests/"]):not([href^="/i/chat/settings"])'
    : '[data-testid^="message-text-"],[data-testid^="message-"] img,[data-testid^="message-"] a[download]') || fallback;
  if (!surface) return null;
  let scroller: HTMLElement | null = surface;
  while (scroller && !(scroller.clientHeight > 0 && scroller.scrollHeight > scroller.clientHeight + 2 && /auto|scroll/.test(getComputedStyle(scroller).overflowY))) scroller = scroller.parentElement;
  scroller ||= Array.from(surface.querySelectorAll<HTMLElement>("*")).find((element) => element.clientHeight > 0 && element.scrollHeight > element.clientHeight + 2 && /auto|scroll/.test(getComputedStyle(element).overflowY)) || surface;
  const before = scroller.scrollTop;
  const step = Math.max(200, scroller.clientHeight * 0.8);
  const reverse = getComputedStyle(scroller).flexDirection === "column-reverse";
  const lower = reverse ? -(scroller.scrollHeight - scroller.clientHeight) : 0;
  const upper = reverse ? 0 : scroller.scrollHeight - scroller.clientHeight;
  if (options.kind === "inbox") {
    scroller.scrollTop = options.direction === "start" ? lower : Math.min(upper, (options.resume ?? before) + step);
  } else {
    scroller.scrollTop = options.direction === "newer" ? upper : Math.max(lower, before - step);
  }
  return { offset: scroller.scrollTop, end: options.kind === "inbox" ? scroller.scrollTop >= upper - 2 : scroller.scrollTop <= lower + 2, moved: Math.abs(before - scroller.scrollTop) > 1 };
}
