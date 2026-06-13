const $ = (id) => document.getElementById(id);

function status(msg, kind = "") {
  const el = $("status");
  el.textContent = msg;
  el.className = "status" + (kind ? " " + kind : "");
}

// Read a cookie by name, trying both x.com and the legacy twitter.com domain.
// chrome.cookies can read httpOnly cookies (that's why we need the permission).
async function getCookie(name) {
  for (const url of ["https://x.com", "https://twitter.com"]) {
    try {
      const c = await chrome.cookies.get({ url, name });
      if (c && c.value) return c.value;
    } catch {
      /* ignore, try next */
    }
  }
  return null;
}

// Remember the app URL + code between popup opens.
chrome.storage.local.get(["appUrl", "code"], (s) => {
  $("appUrl").value = s.appUrl || "http://localhost:3000";
  if (s.code) $("code").value = s.code;
});

$("connect").addEventListener("click", async () => {
  const appUrl = $("appUrl").value.trim().replace(/\/+$/, "");
  const code = $("code").value.trim();
  if (!appUrl) return status("Enter your app URL.", "err");
  if (!code) return status("Enter the pairing code from the app.", "err");

  $("connect").disabled = true;
  status("Reading your X session…");

  const authToken = await getCookie("auth_token");
  const ct0 = await getCookie("ct0");
  if (!authToken || !ct0) {
    status("Not logged into X. Open x.com, sign in, then try again.", "err");
    $("connect").disabled = false;
    return;
  }

  chrome.storage.local.set({ appUrl, code });

  try {
    const res = await fetch(`${appUrl}/api/accounts/x/connect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, authToken, ct0 }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
    status("✓ X connected! Head back to the app.", "ok");
  } catch (e) {
    status(e.message || "Connection failed.", "err");
  } finally {
    $("connect").disabled = false;
  }
});
