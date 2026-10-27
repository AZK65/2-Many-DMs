import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { scrollXSurface } from "./x-dom-scroll";

// Execute the exact serialized function Puppeteer receives, without Node helpers.
test("X scrolling works when the test-id is inside the real scroll container", () => {
  const scroller = { clientHeight: 500, scrollHeight: 2000, scrollTop: 0, parentElement: null };
  const surface = { clientHeight: 2000, scrollHeight: 2000, parentElement: scroller };
  const context = {
    document: { querySelector: (selector: string) => selector.includes("xchatEmbedRoute") ? null : surface },
    getComputedStyle: (element: unknown) => ({ overflowY: element === scroller ? "auto" : "visible", flexDirection: "column" }),
  };
  const scroll = runInNewContext(`(${scrollXSurface.toString()})`, context);
  assert.equal(scroll({ kind: "inbox", direction: "older" }).offset, 400);
  assert.equal(scroll({ kind: "inbox", direction: "older", resume: 1000 }).offset, 1400);
  assert.equal(scroll({ kind: "inbox", direction: "older" }).end, true);
  assert.equal(scroll({ kind: "inbox", direction: "start" }).offset, 0);
  assert.equal(scroll({ kind: "messages", direction: "newer" }).offset, 1500);
  assert.equal(scroll({ kind: "messages", direction: "older" }).offset, 1100);
});

test("X reverse timelines scroll from newest to older using negative offsets", () => {
  const surface = { clientHeight: 500, scrollHeight: 2000, scrollTop: 0 };
  const scroll = runInNewContext(`(${scrollXSurface.toString()})`, {
    document: { querySelector: (selector: string) => selector.includes("xchatEmbedRoute") ? null : surface },
    getComputedStyle: () => ({ overflowY: "auto", flexDirection: "column-reverse" }),
  });
  assert.equal(scroll({ kind: "messages", direction: "newer" }).offset, 0);
  assert.equal(scroll({ kind: "messages", direction: "older" }).offset, -400);
  surface.scrollTop = -1500;
  assert.equal(scroll({ kind: "messages", direction: "older" }).end, true);
});

test("scrolling follows the bubble's pane, not an unrelated named container", () => {
  const actualPane = { clientHeight: 500, scrollHeight: 2000, scrollTop: 1000, parentElement: null };
  const bubble = { clientHeight: 50, scrollHeight: 50, parentElement: actualPane };
  const unrelatedPane = { clientHeight: 500, scrollHeight: 3000, scrollTop: 0 };
  const scroll = runInNewContext(`(${scrollXSurface.toString()})`, {
    document: { querySelector: (selector: string) => selector.includes("xchatEmbedRoute") || selector.includes("dm-message-scroller") ? null : selector.includes("message-text-") ? bubble : unrelatedPane },
    getComputedStyle: (element: unknown) => ({ overflowY: element === bubble ? "visible" : "auto", flexDirection: "column" }),
  });
  assert.equal(scroll({ kind: "messages", direction: "older" }).offset, 600);
  assert.equal(unrelatedPane.scrollTop, 0);
});

test("request recovery scrolls Requests even when General is also mounted", () => {
  const general = { clientHeight: 400, scrollHeight: 2000, scrollTop: 0 };
  const requests = { clientHeight: 400, scrollHeight: 2000, scrollTop: 0 };
  const requestRow = { clientHeight: 40, scrollHeight: 40, parentElement: requests };
  const scroll = runInNewContext(`(${scrollXSurface.toString()})`, {
    document: { querySelector: (selector: string) => selector.includes("xchatEmbedRoute") ? null : selector === 'a[href^="/i/chat/requests/"]' ? requestRow : selector.includes("dm-message-requests-scroller") ? requests : general },
    getComputedStyle: (element: unknown) => ({ overflowY: element === requestRow ? "visible" : "auto", flexDirection: "column" }),
  });
  assert.equal(scroll({ kind: "inbox", direction: "older", category: "spam" }).offset, 320);
  assert.equal(general.scrollTop, 0);
});
