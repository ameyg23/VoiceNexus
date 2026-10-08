# Voice Nexus: Start Commands

Run everything from the repo root: `C:\Users\Amey Gaikwad\Desktop\Voice Nexus`

## First-time setup (once)

```powershell
npm install
npm run db:migrate
npm run db:seed
```

Make sure `.env` exists in the repo root (GEMINI_API_KEY, TWILIO_*, RESEND_API_KEY, JWT_SECRET, etc.).

## Run frontend + backend together

```powershell
npm run dev
```

- Web (Next.js): http://localhost:3000
- Server (Express): http://localhost:4000

## Run them separately (two terminals)

```powershell
# Terminal 1: backend
npm run dev --workspace=apps/server

# Terminal 2: frontend
npm run dev --workspace=apps/web
```

## Real phone / browser calling (Twilio)

Only needed for real calls. Demo Mode (`/demo/call`) works without it.

```powershell
# Terminal 3: public tunnel
ngrok http 4000

# Terminal 4: point Twilio at the tunnel (use the https URL ngrok prints)
npm run twilio:setup --workspace=apps/server -- https://<id>.ngrok-free.app

# Restart `npm run dev` afterwards so the new .env values load
```

Free webhook smoke test (no real call placed):

```powershell
npm run twilio:smoke --workspace=apps/server
```

Note: the care-line webhook can only point at one place at a time (local ngrok or the AWS server). Re-run `twilio:setup` against whichever you want to test.

## Tests

```powershell
npm run test:scenarios --workspace=apps/server
npm run eval:intents --workspace=apps/server
npx tsc --noEmit
```

## Reset demo data

```powershell
npm run db:seed
```

## Troubleshooting

- Port 3000/4000 already in use (orphaned node processes):
  ```powershell
  Get-Process node | Stop-Process -Force
  ```
- Weird Next.js chunk errors after `next build`: delete `apps/web/.next` and restart `npm run dev`.

## Production build (web)

```powershell
npm run build --workspace=apps/web
```

## Logins

- Admin: `priya.sharma@voicenexus.demo` / `admin-demo-pass`
- Customer: `amara.okafor@example.com`-style emails with `<firstname>-demo-pass` (see `DEMO_REFERENCE.md`)

## AWS deployment

See `DEPLOY.md`.
