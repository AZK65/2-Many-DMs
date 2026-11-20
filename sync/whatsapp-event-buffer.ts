type BufferedSocket = {
  ws: { isOpen: boolean };
  ev: { isBuffering(): boolean; flush(): unknown };
};

/** Baileys 6.7.23 can re-enable buffering for a live upsert without ever
 * releasing it after initial sync. Drain already received events, without
 * fetching history, sending messages, resetting sessions or changing IDs.
 * Keep the startup grace for the library's initial history consolidation. */
export function drainWhatsAppEvents(socket: BufferedSocket, connectedAt: number, now = Date.now()): boolean {
  if (!connectedAt || now - connectedAt < 20_000 || !socket.ws.isOpen || !socket.ev.isBuffering()) return false;
  socket.ev.flush();
  return true;
}
