import "dotenv/config";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import input from "input";

const apiId = Number(process.env.TELEGRAM_API_ID);
const apiHash = process.env.TELEGRAM_API_HASH;

async function main() {
  if (!apiId || !apiHash) {
    console.error(
      "Missing TELEGRAM_API_ID / TELEGRAM_API_HASH in omni-crm/.env.\n" +
        "Get them from https://my.telegram.org → API development tools."
    );
    process.exit(1);
  }

  const client = new TelegramClient(new StringSession(""), apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: async () =>
      await input.text("Phone number (international, e.g. +14155550123): "),
    password: async () =>
      await input.password("2FA password (press Enter if you have none): "),
    phoneCode: async () =>
      await input.text("Login code Telegram just sent you: "),
    onError: (err) => console.error(err),
  });

  const session = client.session.save() as unknown as string;
  console.log("\n✅ Logged in. Add this line to omni-crm/.env:\n");
  console.log(`TELEGRAM_SESSION=${session}\n`);
  await client.disconnect();
  process.exit(0);
}

main();
