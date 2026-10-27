export const GMAIL_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.modify",
];

export function gmailRedirectUri(): string {
  return `${process.env.WEB_URL || "http://localhost:3000"}/api/accounts/gmail/callback`;
}

export function gmailOAuthConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required");
  return { clientId, clientSecret, redirectUri: gmailRedirectUri() };
}
