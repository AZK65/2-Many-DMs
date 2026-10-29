# Ask your chats

Settings is the gear in the left rail, immediately above AI assistant. During setup, the optional AI step follows Channels. **Skip for now** leaves messaging and normal search fully usable. Existing installs can connect later in **Settings → AI assistant**.

1. Open [OpenRouter keys](https://openrouter.ai/settings/keys), sign in, add credits, and create a key with a spending cap.
2. Paste it in 2Many, review the data-sharing disclosure, and choose **Connect AI**. Validation only checks key metadata, not chat content.
3. Open **AI assistant**. Ask about all synced chats or just the current conversation. Source buttons open the original message. Clear resets the in-memory assistant conversation; nothing is sent to contacts.

The assistant uses GPT-4.1 Mini via OpenRouter. Questions, recent assistant follow-ups, and relevant retrieved text/OCR excerpts go to OpenRouter and its provider. Requests require `data_collection: deny` and `zdr: true`. If no eligible provider is available, requests fail; there is no less-private fallback. Usage is billed separately by OpenRouter. Set a per-key spending cap there.

The assistant can search messages, summarize, draft text, and count synced messages/conversations. It cannot send, delete, edit, or perform account actions. It does not inspect raw photos, voice notes, or unsynced history. Counts of conversations are not deduplicated counts of people. Search results are bounded and can be incomplete; always verify sources.

Keys are stored encrypted under `.local/assistant/`, using a random per-installation encryption key and owner-specific files, with private filesystem permissions. Keys are never returned to the browser or saved in localStorage. Keep this directory private, preserve it on a persistent volume when moving servers, and never publish it. Back up encrypted records and `encryption.key` together. Removing the saved key disables the assistant but does not revoke the key at OpenRouter; revoke it there if needed.

This follows the existing personal, single-owner installation access model. It does not add multi-user authentication or make the app safe to expose publicly. Guest sharing and marketing deployments cannot use these endpoints.

Checks: `npx tsx --test scripts/chat-assistant.test.ts`, `node scripts/verify-assistant.mjs` against a local test server, `npx tsc --noEmit`, and `npm run privacy:check`. Tests use fictional fixtures and never send real chats to an AI service.
