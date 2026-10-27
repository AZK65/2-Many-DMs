const $ = id => document.getElementById(id);
function status(message, kind = "") { $("status").textContent = message; $("status").className = `status ${kind}`; }
async function readSession() {
  for (const url of ["https://x.com", "https://twitter.com"]) {
    const [auth, csrf] = await Promise.all(["auth_token", "ct0"].map(name => chrome.cookies.get({ url, name })));
    if (auth?.value && csrf?.value) return { authToken: auth.value, ct0: csrf.value };
  }
  return null;
}
chrome.storage.local.get(["appUrl"], saved => { $("appUrl").value = saved.appUrl || "http://localhost:3000"; });
chrome.storage.local.remove("code"); // pairing codes should never persist beyond a popup
$("setup").addEventListener("submit", async event => {
  event.preventDefault();
  if ($("connect").disabled) return;
  let app;
  try {
    app = new URL($("appUrl").value.trim());
    if (app.username || app.password || (app.protocol !== "https:" && !(app.protocol === "http:" && ["localhost", "127.0.0.1"].includes(app.hostname)))) throw Error();
  } catch { return status("Use the exact App URL shown in setup. HTTPS is required except on your own computer.", "err"); }
  const code = $("code").value.trim().toUpperCase();
  if (!/^[A-Z0-9]{6,10}$/.test(code)) return status("Paste the pairing code from the app. Generate a fresh one if it expired.", "err");
  $("connect").disabled = true;
  try {
    // Requested from the explicit click, before reading any session cookies.
    const granted = await chrome.permissions.request({ origins: [`${app.protocol}//${app.hostname}/*`] });
    if (!granted) return status("Allow access to your app address so the connector can send the session there.", "err");
    status("Reading the X account signed in to this browser…");
    const session = await readSession();
    if (!session) return status("Open x.com in this browser and sign in, then try again. Private windows use a separate session.", "err");
    await chrome.storage.local.set({ appUrl: app.origin });
    status("Saving your session securely…");
    const response = await fetch(`${app.origin}/api/accounts/x/connect`, {
      method: "POST", redirect: "error", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, ...session }), signal: AbortSignal.timeout(15_000),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) throw new Error(data?.error || "Your app did not accept this connection. Check its address and open its private owner view first.");
    $("code").value = "";
    status("Session saved. Return to setup to check live sync and unlock X Chat if requested.", "ok");
  } catch (error) {
    status(error.name === "TimeoutError" ? "The server took too long. Check setup first; if it is still waiting, retry with this code." : error.message || "Cannot reach your app. Check the App URL and server connection.", "err");
  } finally { $("connect").disabled = false; }
});
