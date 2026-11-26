# Connect agents to your chats

Open **Settings → Integrations → Agent access → Add agent**. Give each agent its own name, choose the messaging accounts it can read, and copy the key once. Revoke a key here to stop subsequent requests immediately. Requests already in progress may finish.

The MCP server is part of the app service at `http://127.0.0.1:3000/api/mcp`. It stays available when the browser closes, provided the app service and computer stay running. The normal installed background service starts it again after a restart. A development server must be kept running manually. Each isolated workspace has its own endpoint, database, and keys.

## HTTP clients

Use **Streamable HTTP**, the endpoint above, and the header `Authorization: Bearer YOUR_AGENT_KEY`. Agents that support URL-and-header MCP configuration can use this template (configuration names vary by host):

```json
{
  "mcpServers": {
    "2manydms": {
      "type": "http",
      "url": "http://127.0.0.1:3000/api/mcp",
      "headers": { "Authorization": "Bearer YOUR_AGENT_KEY" }
    }
  }
}
```

## Clients that use local commands

Use Node 20 or later and the bridge included with the app. Replace the absolute installation path and keep the key in your agent's private configuration/secret storage:

```json
{
  "mcpServers": {
    "2manydms": {
      "command": "node",
      "args": ["/absolute/path/to/2-Many-DMs/scripts/mcp-bridge.mjs"],
      "env": {
        "TMD_MCP_URL": "http://127.0.0.1:3000/api/mcp",
        "TMD_MCP_KEY": "YOUR_AGENT_KEY"
      }
    }
  }
}
```

The bridge connects to the running app; it does not start a second sync process or read the database itself. It supports the initialize-based MCP protocol used by stdio hosts. HTTP supports both the 2025 and 2026 protocol families through the official SDK.

## Remote agents

Localhost is reachable only on this computer. For an agent on another machine, arrange a dedicated HTTPS reverse proxy or VPN that reaches the app, then set `MCP_PUBLIC_URL=https://your-private-host/api/mcp` in the app's environment and restart the web service. Preserve that hostname in the proxy's Host header, expose the MCP/OAuth paths using `node scripts/mcp-gateway.mjs`, and keep the upstream app bound to loopback. The gateway listens on loopback port 4030 by default, forwards only MCP, OAuth discovery/consent and their static assets, and rejects other routes. Point your HTTPS tunnel at that gateway. Do not expose `/api/mcp/access` or the rest of the local app through a permissive proxy. Remote key management is deliberately unavailable.

This setting authorizes the hostname; it does not provision a domain, tunnel, or certificate. Bearer keys are mandatory even on localhost. For ChatGPT and Claude web, choose OAuth in their custom connector setup. The server supports authorization discovery, dynamic client registration, authorization codes with PKCE (S256), and rotating refresh tokens. The authorization screen asks for the agent key you created in local Settings; this approves only that key's selected accounts. Access tokens expire after 15 minutes and refresh tokens after 30 days. Revoking the parent key immediately blocks both. No account password or platform login is shared with the agent. The public marketing website never serves chat MCP data.

## What agents can do

- `connection_status`: permitted account status and counts of saved chats/messages.
- `search_chats`: recent conversations, or contacts/groups by name, handle, email, or phone.
- `search_messages`: text and completed local photo OCR, filtered by chat, platform, or time.
- `read_chat`: latest messages, then older history through a pagination cursor.

Try “Find my latest conversation with Alex” or “What did we agree on last week? Include the message dates.” The agent produces the answer using these tools; the MCP server does not run an additional AI model.

Access is read-only and limited to the accounts selected when the key was created. Newly connected accounts require a new key. Sending, editing, deleting, marking read, downloading attachments, starting OCR/sync, credentials, internal integrations, and arbitrary database queries are not exposed. The selected agent receives the chat content it requests and may process it outside this computer according to that agent's settings.

Search sees only saved messages and OCR already completed locally. Results flag unverified X inbox previews and explain that history may still be restoring. Deleted messages are excluded. Long text is marked as truncated. Conversation links are relative to your app address. Reading does not change unread counts.

Keys are randomly generated; only SHA-256 digests are stored with restrictive file permissions in the workspace's ignored `.local/mcp/access.json`. Do not commit or share this file or an agent config containing a key. Each key is limited to 60 requests per minute and four simultaneous requests; each result page has at most 50 messages.

Protocol implementation: [official MCP TypeScript SDK HTTP handler](https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28).
