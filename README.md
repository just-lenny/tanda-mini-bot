# Tanda Mini Bot

Tanda Mini Bot is a WhatsApp pairing service built with Node.js, Baileys, Express, and Supabase. Users enter their phone number on the hosted page, receive a WhatsApp pairing code, and link their WhatsApp account. The website does not require a user account.

## Features

- Phone-number pairing flow for WhatsApp Linked Devices.
- Supabase persistence for Baileys credentials and Signal keys.
- Restores saved WhatsApp sessions after a Render restart.
- Framed command replies for `.menu`, `.help`, `.ping`, `.info`, `.owner`, and `.status`.
- Responsive glass-style web interface with service health status.
- No Supabase credentials exposed to the browser.

## Requirements

- Node.js 20 or newer.
- A Supabase project.
- A Render Web Service.
- A WhatsApp account that can use Linked Devices.

## 1. Configure Supabase

Open the Supabase SQL Editor and run the contents of `supabase.sql`. This creates `public.tanda_sessions`.

In your Supabase project settings, copy the project URL and the **service role** key. The service role key bypasses Row Level Security, so it must only be configured as a private server environment variable. Never add it to frontend JavaScript or commit it to Git.

## 2. Run locally

```bash
npm install
```

Copy `.env.example` to `.env`, fill in the Supabase values, then run:

```bash
npm start
```

Open `http://localhost:3000`.

## 3. Deploy to Render

1. Push this project to a Git repository.
2. In Render, create a **Web Service** connected to that repository.
3. Set the runtime to Node.
4. Set the build command to `npm install`.
5. Set the start command to `npm start`.
6. Add these environment variables in Render:

| Variable | Value |
| --- | --- |
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Your private service-role key |
| `OWNER_NAME` | `Lenny Muriuki` |
| `COMPANY_NAME` | `Deçan Techs` |
| `BOT_NAME` | `Tanda Mini Bot` |
| `NODE_ENV` | `production` |

`PORT` is provided by Render automatically. Do not commit `.env` or the service-role key.

## 4. Pair a phone

1. Open the deployed Render URL.
2. Enter the phone number in international format without `+`, spaces, or punctuation. For Kenya, use `2547XXXXXXXX`, omitting the leading `0`.
3. Press **Generate pairing code**.
4. On the phone, open WhatsApp → Settings → Linked devices → Link a device → Link with phone number instead.
5. Enter the pairing code shown on the site.

After WhatsApp confirms the link, the bot sends a connection confirmation. Try `.menu`, `.help`, `.ping`, `.info`, `.owner`, or `.status` in a chat.

## Operations and limitations

- Supabase stores authentication credentials and cryptographic session keys. Treat the database and service-role key as highly sensitive.
- Anyone who controls a linked session may be able to send messages as that WhatsApp account. Only pair numbers you own or are authorized to administer.
- WhatsApp may revoke linked devices or change its protocol. This project uses the unofficial Baileys library, so compatibility is not guaranteed.
- A Render service is not guaranteed to run continuously on every plan. Free services may sleep or have usage limits; choose an always-on paid service if continuous availability is required.
- This app reconnects saved sessions after a process restart, but no hosting platform can guarantee zero downtime.
- The included commands are a starter set. Extend `handleMessage` in `server.js` to add more commands.
- Do not expose session data through public endpoints. The status endpoint intentionally reports only aggregate counts.

## Health endpoint

`GET /api/health` returns a small JSON status response suitable for a health check.

## Project layout

```text
tanda-mini-bot/
├── public/
│   ├── app.js
│   ├── index.html
│   └── styles.css
├── .env.example
├── .gitignore
├── package.json
├── server.js
├── supabase.sql
└── README.md
```
