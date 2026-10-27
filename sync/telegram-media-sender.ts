/** GramJS downloads call getSender(mainDc) after their first chunk. The default
 * opens a second connection even for the already authenticated primary DC.
 * Reuse the live sender there; other DCs still use normal exported senders. */
export function reuseTelegramPrimarySender<T>(client: {
  session: { dcId: number };
  getSender: (dcId: number) => Promise<T>;
}): void {
  const getSender = client.getSender.bind(client);
  // GramJS uses a falsy DC ID to select the primary sender.
  client.getSender = dcId => getSender(dcId === client.session.dcId ? 0 : dcId);
}
