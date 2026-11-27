const { Api } = require("teleproto");

/** Photo helpers share an authorization with the inbox, but must never become
 * its update connection. Telegram routes updates to the last subscribed socket.
 * File queries opt out already; config, entity and authorization queries do not.
 */
function configureDownloadOnlyClient(client) {
  if (typeof client._buildInitConnection !== "function" ||
      typeof client.invoke !== "function" ||
      typeof client.invokeWithSender !== "function" ||
      typeof client._updateLoop?.start !== "function") {
    throw Error("Telegram download isolation is unavailable");
  }
  const withoutUpdates = query => query instanceof Api.InvokeWithoutUpdates ||
      query.className.startsWith("upload.")
    ? query : new Api.InvokeWithoutUpdates({ query });
  // connect() sends its initial config directly through the sender, before
  // invoke(). Cover that first request (and initialization after a DC change).
  const buildInit = client._buildInitConnection.bind(client);
  client._buildInitConnection = query => buildInit(withoutUpdates(query));
  const invoke = client.invoke.bind(client);
  client.invoke = (query, ...args) => invoke(withoutUpdates(query), ...args);
  const invokeWithSender = client.invokeWithSender.bind(client);
  client.invokeWithSender = (query, ...args) => invokeWithSender(withoutUpdates(query), ...args);
  // These short-lived workers only fetch files. They neither consume updates
  // nor run a competing difference/catch-up loop under the shared authorization.
  client._updateLoop.start = () => {};
}

module.exports = { configureDownloadOnlyClient };
