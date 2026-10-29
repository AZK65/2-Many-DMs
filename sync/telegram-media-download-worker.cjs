// Own the download's sockets in a disposable thread. GramJS can leave a file
// request pending across a reconnect; terminating this thread cancels the real
// transport instead of merely timing out an HTTP observer of that request.
const { parentPort, workerData } = require("node:worker_threads");
const { Api, TelegramClient, utils } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { BinaryReader } = require("telegram/extensions/BinaryReader");
const { Logger } = require("telegram/extensions/Logger");

async function resolveProfileEntity(client, peer) {
  // GramJS getEntity cannot getPeerId(InputPeerUserFromMessage). Use the
  // native typed request instead, still checking the returned user ID.
  if (peer instanceof Api.InputPeerUserFromMessage) {
    const users = await client.invoke(new Api.users.GetUsers({ id: [utils.getInputUser(peer)] }));
    return users.find(user => String(user.id) === String(peer.userId));
  }
  return client.getEntity(peer);
}
module.exports = { resolveProfileEntity };

async function download() {
  const client = new TelegramClient(new StringSession(workerData.session),
    workerData.apiId, workerData.apiHash, {
      connectionRetries: 1,
      requestRetries: 1,
      reconnectRetries: 0,
      autoReconnect: false,
      floodSleepThreshold: 0,
      baseLogger: new Logger("none"),
    });
  client.setLogLevel("none");
  // Do not create an exported connection to the already authenticated DC.
  const getSender = client.getSender.bind(client);
  client.getSender = dc => getSender(dc === client.session.dcId ? 0 : dc);
  const media = new BinaryReader(Buffer.from(workerData.media)).tgReadObject();
  try {
    await client.connect();
    if (workerData.profile) {
      // Refresh the actual entity instead of reusing an old photo reference.
      // The parent supplies an exact typed peer, optionally tied to a known
      // group message. Resolving it does not read/mark that conversation.
      const entity = await resolveProfileEntity(client, media);
      if (!entity || String(entity.id) !== workerData.profile.id ||
          Boolean(entity.title) !== workerData.profile.isGroup || !entity.photo) {
        parentPort.postMessage({ unavailable: true });
        return;
      }
      const bytes = await client.downloadProfilePhoto(entity, { isBig: false });
      if (!bytes?.length) parentPort.postMessage({ unavailable: true });
      else if (bytes.length > workerData.maxBytes) throw Error("Telegram profile photo exceeds the size limit");
      else parentPort.postMessage({ bytes });
      return;
    }
    const bytes = await client.downloadMedia(media, {
      ...(workerData.thumb !== undefined ? { thumb: workerData.thumb } : {}),
      progressCallback: (received) => {
        if (Number(received) > workerData.maxBytes) throw Error("Telegram attachment exceeds the download size limit");
      },
    });
    if (!Buffer.isBuffer(bytes) || !bytes.length) throw Error("Telegram returned an empty attachment");
    if (bytes.length > workerData.maxBytes) throw Error("Telegram attachment exceeds the download size limit");
    parentPort.postMessage({ bytes });
  } catch (error) {
    if (workerData.profile && /CHANNEL_INVALID|CHANNEL_PRIVATE|CHAT_ID_INVALID|USER_ID_INVALID|PEER_ID_INVALID|PHOTO_ID_INVALID|USER_PRIVACY_RESTRICTED|MSG_ID_INVALID/i.test(String(error?.errorMessage || error?.message))) {
      parentPort.postMessage({ unavailable: true });
      return;
    }
    parentPort.postMessage({ error: String(error?.errorMessage || error?.message || "Telegram download failed"),
      seconds: Number(error?.seconds || 0) });
  }
  // The parent always terminates and awaits thread exit, including every
  // exported sender, before permitting the next download.
}
if (parentPort) download().catch(() => parentPort.postMessage({ error: "Telegram download could not start" }));
