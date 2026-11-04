# chat-telegram-notify

Sends a Telegram message when a visitor sends their **first** support-chat message.

## Secrets (Supabase Dashboard → Edge Functions → Secrets)

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

Or via CLI (from repo root):

```bash
supabase secrets set TELEGRAM_BOT_TOKEN="YOUR_BOT_TOKEN" TELEGRAM_CHAT_ID="YOUR_CHAT_ID" --project-ref gskncyonfpcoxxnnnjhe
supabase functions deploy chat-telegram-notify --project-ref gskncyonfpcoxxnnnjhe
```

Do **not** put these values in Vercel env vars.
